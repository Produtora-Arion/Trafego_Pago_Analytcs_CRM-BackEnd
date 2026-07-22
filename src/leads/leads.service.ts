import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsEmail, IsInt, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Lead, LeadStatus } from './lead.entity';

/**
 * Classe (não interface) pra ganhar validação de verdade via class-validator
 * na rota POST /leads. O webhook de formulário (lead-webhook.controller.ts)
 * monta esse objeto internamente e chama o service direto — nunca passa pelo
 * ValidationPipe — então continua tão flexível quanto antes pra campos livres.
 */
export class CreateLeadDto {
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) gclid?: string;
  @IsOptional() @IsString() @MaxLength(200) fbclid?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() conversionActionId?: string;
  @IsOptional() @IsString() @MaxLength(4000) firstMessage?: string;
  @IsOptional() @IsString() @MaxLength(500) formChoice?: string;
  @IsOptional() @IsString() @MaxLength(200) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(200) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(200) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(200) utmContent?: string;
  @IsOptional() @IsString() @MaxLength(200) utmTerm?: string;
  @IsOptional() @IsString() @MaxLength(2000) landingPage?: string;
  @IsOptional() @IsString() @MaxLength(2000) referrer?: string;
  @IsOptional() @IsString() @MaxLength(100) ip?: string;
  @IsOptional() @IsString() @MaxLength(500) userAgent?: string;
  @IsOptional() @IsString() @MaxLength(50) browserLanguage?: string;
  @IsOptional() @IsString() @MaxLength(200) sessionId?: string;
  @IsOptional() @IsString() extraData?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: LeadStatus;
  /** Referência estável à etapa do CRM — fonte de verdade da coluna do lead */
  @IsOptional() @IsInt() stageId?: number;
}

/** Edição manual no modal de rastreamento — mesmos campos da allowlist EDITABLE_FIELDS do service. */
export class UpdateLeadFieldsDto {
  [key: string]: unknown; // permite indexação por chave dinâmica em updateFields()
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) formChoice?: string;
  @IsOptional() @IsString() @MaxLength(200) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(200) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(200) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(200) utmContent?: string;
  @IsOptional() @IsString() @MaxLength(200) utmTerm?: string;
  @IsOptional() @IsString() extraData?: string;
  @IsOptional() @IsNumber() conversionValue?: number;
  @IsOptional() @IsString() @MaxLength(4000) obs?: string;
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

  /** Quantos leads chegados no mês (YYYY-MM) estão hoje em cada etapa — agrupado por stageId. */
  async getMonthlyFunnel(customerId: string, month: string): Promise<{ stageId: number | null; count: number }[]> {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const rows = await this.repo
      .createQueryBuilder('lead')
      .select('lead.stageId', 'stageId')
      .addSelect('COUNT(*)', 'count')
      .where('lead.customerId = :customerId', { customerId })
      .andWhere('lead.firstContactAt >= :start', { start })
      .andWhere('lead.firstContactAt < :end', { end })
      .groupBy('lead.stageId')
      .getRawMany();

    return rows.map((r) => ({ stageId: r.stageId !== null ? Number(r.stageId) : null, count: Number(r.count) }));
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

  /**
   * Move o lead para outra etapa. stageId é a fonte de verdade; status (label)
   * só acompanha para exibição. O motivo de perda só faz sentido enquanto o
   * lead está na etapa fixa "Perdido" — sair dela desatribui o motivo (esta
   * rota nunca move PARA "Perdido", isso é sempre via markLost()).
   */
  async updateStage(id: number, stageId: number, label: string, tenantId: string | null): Promise<Lead> {
    const lead = await this.findScoped(id, tenantId);
    lead.stageId = stageId;
    lead.status = label;
    lead.statusChangedAt = new Date();
    lead.lossReasonId = null;
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
    lead.lossReasonId = null; // saiu de "Perdido" (ou nunca esteve) — motivo não se aplica mais
    if (customerId) lead.customerId = customerId;
    if (conversionActionId) lead.conversionActionId = conversionActionId;
    return this.repo.save(lead);
  }

  async markConversionUploaded(id: number): Promise<void> {
    await this.repo.update(id, { conversionUploadedAt: new Date() });
  }

  /** Move o lead pra etapa fixa "Perdido", registrando o motivo escolhido. */
  async markLost(
    id: number,
    stageId: number,
    statusLabel: string,
    lossReasonId: number,
    tenantId: string | null,
  ): Promise<Lead> {
    const lead = await this.findScoped(id, tenantId);
    lead.stageId = stageId;
    lead.status = statusLabel;
    lead.statusChangedAt = new Date();
    lead.lossReasonId = lossReasonId;
    return this.repo.save(lead);
  }

  /** Mesma lista de campos aceitos pela UpdateLeadFieldsDto — mantidas juntas de propósito */
  private static readonly EDITABLE_FIELDS = [
    'name', 'email', 'phone', 'formChoice',
    'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
    'extraData', 'conversionValue', 'obs',
  ] as const;

  async updateFields(id: number, fields: UpdateLeadFieldsDto, tenantId: string | null): Promise<Lead> {
    const lead = await this.findScoped(id, tenantId);
    for (const key of LeadsService.EDITABLE_FIELDS) {
      if (fields[key] !== undefined) (lead as any)[key] = fields[key];
    }
    return this.repo.save(lead);
  }

  async updateReminders(id: number, reminders: string | null, tenantId: string | null): Promise<Lead> {
    const lead = await this.findScoped(id, tenantId);
    lead.reminders = reminders;
    return this.repo.save(lead);
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
