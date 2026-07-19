import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStatus } from './lead.entity';

export interface CreateLeadDto {
  phone?: string;
  email?: string;
  name?: string;
  gclid?: string;
  fbclid?: string;
  customerId?: string;
  conversionActionId?: string;
  firstMessage?: string;
  formChoice?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPage?: string;
  referrer?: string;
  ip?: string;
  userAgent?: string;
  browserLanguage?: string;
  sessionId?: string;
  extraData?: string;
  status?: LeadStatus;
  /** Referência estável à etapa do CRM — fonte de verdade da coluna do lead */
  stageId?: number;
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly repo: Repository<Lead>,
  ) {}

  async findAll(customerId?: string): Promise<Lead[]> {
    const where = customerId ? { customerId } : {};
    return this.repo.find({ where, order: { firstContactAt: 'DESC' } });
  }

  async findByPhone(phone: string): Promise<Lead | null> {
    return this.repo.findOne({ where: { phone } });
  }

  /** Busca duplicado por telefone OU e-mail, dentro do mesmo cliente (customerId) */
  private async findDuplicate(data: CreateLeadDto): Promise<Lead | null> {
    const scope = data.customerId ? { customerId: data.customerId } : {};
    if (data.phone) {
      const byPhone = await this.repo.findOne({ where: { ...scope, phone: data.phone } });
      if (byPhone) return byPhone;
    }
    if (data.email) {
      const byEmail = await this.repo.findOne({ where: { ...scope, email: data.email } });
      if (byEmail) return byEmail;
    }
    return null;
  }

  async upsertFromWebhook(data: CreateLeadDto): Promise<Lead> {
    const existing = await this.findDuplicate(data);
    if (existing) {
      // Preenche campos que o lead ainda não tinha (não sobrescreve dados existentes)
      let changed = false;
      const fillIfEmpty: (keyof CreateLeadDto & keyof Lead)[] = [
        'name', 'email', 'phone', 'gclid', 'fbclid',
        'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
        'landingPage', 'referrer', 'ip', 'userAgent', 'browserLanguage', 'sessionId',
        'formChoice',
      ];
      for (const key of fillIfEmpty) {
        if (data[key] && !existing[key]) {
          (existing as any)[key] = data[key];
          changed = true;
        }
      }
      if (changed) return this.repo.save(existing);
      return existing;
    }

    const lead = this.repo.create({ ...data, status: data.status || 'Novo', statusChangedAt: new Date() });
    return this.repo.save(lead);
  }

  // Mantém compatibilidade com WhatsApp webhook
  async upsertFromWhatsApp(phone: string, gclid: string | null, firstMessage: string): Promise<Lead> {
    return this.upsertFromWebhook({ phone, gclid: gclid ?? undefined, firstMessage });
  }

  /**
   * Monta o filtro de busca isolado por tenant.
   * tenantId = null  → admin (acesso a qualquer lead)
   * tenantId = string → cliente (somente leads do próprio customerId)
   */
  private scopedWhere(id: number, tenantId: string | null) {
    return tenantId ? { id, customerId: tenantId } : { id };
  }

  /** Busca um lead respeitando o isolamento por tenant, ou lança 404 */
  private async findScoped(id: number, tenantId: string | null): Promise<Lead> {
    const lead = await this.repo.findOne({ where: this.scopedWhere(id, tenantId) });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  /** Move o lead para outra etapa. stageId é a fonte de verdade; status (label) só acompanha para exibição. */
  async updateStage(id: number, stageId: number, label: string, tenantId: string | null): Promise<Lead> {
    const lead = await this.findScoped(id, tenantId);
    lead.stageId = stageId;
    lead.status = label;
    lead.statusChangedAt = new Date();
    return this.repo.save(lead);
  }

  async markConverted(
    id: number,
    value: number,
    customerId: string,
    conversionActionId: string,
    tenantId: string | null,
    stageId?: number,
    statusLabel?: string,
  ): Promise<Lead> {
    const lead = await this.findScoped(id, tenantId);
    lead.status = statusLabel || 'Convertido';
    if (stageId) lead.stageId = stageId;
    lead.statusChangedAt = new Date();
    lead.convertedAt = new Date();
    lead.conversionValue = value;
    if (customerId) lead.customerId = customerId;
    if (conversionActionId) lead.conversionActionId = conversionActionId;
    return this.repo.save(lead);
  }

  async markConversionUploaded(id: number): Promise<void> {
    await this.repo.update(id, { conversionUploadedAt: new Date() });
  }

  async createManual(data: CreateLeadDto): Promise<Lead> {
    const existing = await this.findDuplicate(data);
    if (existing) return existing;
    const lead = this.repo.create({ ...data, status: data.status || 'Novo', statusChangedAt: new Date() });
    return this.repo.save(lead);
  }

  async deleteById(id: number, tenantId: string | null): Promise<void> {
    const res = await this.repo.delete(this.scopedWhere(id, tenantId));
    if (!res.affected) throw new NotFoundException('Lead não encontrado');
  }
}
