import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LossReason } from './loss-reason.entity';
import { Lead } from '../leads/lead.entity';

@Injectable()
export class LossReasonsService {
  constructor(
    @InjectRepository(LossReason)
    private readonly repo: Repository<LossReason>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
  ) {}

  /** Lista todos os motivos (ativos e inativos) — a UI decide o que exibir onde. */
  async findAll(customerId: string): Promise<LossReason[]> {
    return this.repo.find({ where: { customerId }, order: { createdAt: 'ASC' } });
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
    if (data.label !== undefined) reason.label = data.label;
    if (data.active !== undefined) reason.active = data.active;
    return this.repo.save(reason);
  }

  async delete(id: number, tenantId: string | null): Promise<void> {
    const reason = await this.findById(id, tenantId);

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
