import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LossReason } from './loss-reason.entity';
import { Lead } from '../leads/lead.entity';

/**
 * "Fantasma" e "Lead Desqualificado" são os 2 motivos que disparam o sinal
 * negativo pro Google Ads (ver LeadsController.lose) — todo cliente precisa
 * ter os dois, sempre. "Sem Enquadramento" é só uma sugestão pronta (motivo
 * de negócio legítimo, não dispara nada) — semeado por padrão pra poupar
 * trabalho, mas não é obrigatório nem protegido como os outros dois.
 */
const DEFAULT_REASONS = [
  { label: 'Fantasma', kind: 'fantasma' as const },
  { label: 'Lead Desqualificado', kind: 'desqualificado' as const },
  { label: 'Sem Enquadramento', kind: 'default' as const },
];

@Injectable()
export class LossReasonsService {
  constructor(
    @InjectRepository(LossReason)
    private readonly repo: Repository<LossReason>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
  ) {}

  /**
   * Lista todos os motivos (ativos e inativos) — a UI decide o que exibir
   * onde. Garante, sempre, que "Fantasma" e "Lead Desqualificado" existem
   * pra este cliente — cria na primeira vez, e autocura se faltar um dos
   * dois depois (ex: conta criada antes dessa regra existir). Mesma lógica
   * de CrmStagesService pras etapas fixas Ganho/Perdido.
   */
  async findAll(customerId: string): Promise<LossReason[]> {
    const reasons = await this.repo.find({ where: { customerId }, order: { createdAt: 'ASC' } });

    if (reasons.length === 0) {
      const created = await Promise.all(
        DEFAULT_REASONS.map(r => this.repo.save(this.repo.create({ ...r, customerId, active: true }))),
      );
      return created;
    }

    const missingKinds = (['fantasma', 'desqualificado'] as const).filter(
      k => !reasons.some(r => r.kind === k),
    );
    if (missingKinds.length > 0) {
      const toCreate = missingKinds.map(k => {
        const def = DEFAULT_REASONS.find(r => r.kind === k)!;
        return this.repo.create({ ...def, customerId, active: true });
      });
      const created = await Promise.all(toCreate.map(r => this.repo.save(r)));
      return [...reasons, ...created];
    }

    return reasons;
  }

  /** Busca um motivo pelo id, respeitando o isolamento por tenant, ou lança 404 */
  async findById(id: number, tenantId: string | null): Promise<LossReason> {
    const where = tenantId ? { id, customerId: tenantId } : { id };
    const reason = await this.repo.findOne({ where });
    if (!reason) throw new NotFoundException('Motivo de perda não encontrado');
    return reason;
  }

  async create(customerId: string, label: string): Promise<LossReason> {
    return this.repo.save(this.repo.create({ customerId, label, active: true }));
  }

  async update(
    id: number,
    data: { label?: string; active?: boolean },
    tenantId: string | null,
  ): Promise<LossReason> {
    const reason = await this.findById(id, tenantId);

    // "Fantasma" e "Lead Desqualificado" são fixos: o Google Ads é avisado
    // por eles especificamente (ver LeadsController.lose) — renomear ou
    // desativar quebraria esse sinal silenciosamente. Pode existir outros
    // motivos com nome parecido, mas estes dois nunca mudam.
    if (reason.kind !== 'default') {
      if (data.label !== undefined && data.label !== reason.label) {
        throw new ForbiddenException('Este motivo é fixo e não pode ser renomeado');
      }
      if (data.active === false) {
        throw new ForbiddenException('Este motivo é fixo e não pode ser desativado');
      }
    }

    if (data.label !== undefined) reason.label = data.label;
    if (data.active !== undefined) reason.active = data.active;
    return this.repo.save(reason);
  }

  async delete(id: number, tenantId: string | null): Promise<void> {
    const reason = await this.findById(id, tenantId);

    if (reason.kind !== 'default') {
      throw new ForbiddenException('Este motivo é fixo e não pode ser excluído');
    }

    // Nunca excluir um motivo já usado — quebraria o histórico de leads
    // marcados com ele. Desativar (active: false) é o caminho pra "remover"
    // um motivo em uso sem perder o que já foi registrado.
    const leadCount = await this.leadsRepo.count({ where: { lossReasonId: reason.id } });
    if (leadCount > 0) {
      throw new ConflictException(
        `Não é possível excluir: ${leadCount} lead(s) usam este motivo. Desative-o em vez de excluir.`,
      );
    }

    await this.repo.delete(id);
  }
}
