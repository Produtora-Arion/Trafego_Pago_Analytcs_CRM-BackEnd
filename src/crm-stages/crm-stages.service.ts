import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CrmStage } from './crm-stage.entity';
import { Lead } from '../leads/lead.entity';

const DEFAULT_STAGES = [
  { label: 'Novo',           color: '#0ea5e9', position: 0, triggersConversion: false, isEntryStage: true  },
  { label: 'Em Atendimento', color: '#f59e0b', position: 1, triggersConversion: false, isEntryStage: false },
  { label: 'Convertido',     color: '#22c55e', position: 2, triggersConversion: true,  isEntryStage: false },
  { label: 'Perdido',        color: '#ef4444', position: 3, triggersConversion: false, isEntryStage: false },
];

@Injectable()
export class CrmStagesService {
  constructor(
    @InjectRepository(CrmStage)
    private readonly stagesRepo: Repository<CrmStage>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
  ) {}

  async findAll(customerId: string): Promise<CrmStage[]> {
    const stages = await this.stagesRepo.find({
      where: { customerId },
      order: { position: 'ASC' },
    });

    // Cria etapas padrão na primeira vez que um cliente acessa o CRM
    if (stages.length === 0) {
      const created = await Promise.all(
        DEFAULT_STAGES.map(s => this.stagesRepo.save(this.stagesRepo.create({ ...s, customerId }))),
      );
      return created.sort((a, b) => a.position - b.position);
    }

    return stages;
  }

  /** Etapa que recebe novos leads do webhook. Sem marcação explícita, cai na primeira por posição. */
  async findEntryStage(customerId: string): Promise<CrmStage | null> {
    const stages = await this.findAll(customerId);
    if (stages.length === 0) return null;
    return stages.find(s => s.isEntryStage) ?? stages[0];
  }

  async create(
    customerId: string,
    label: string,
    color: string,
    triggersConversion: boolean,
    isEntryStage = false,
  ): Promise<CrmStage> {
    const max = await this.stagesRepo.maximum('position', { customerId }) ?? -1;
    if (isEntryStage) await this.clearEntryStage(customerId);
    const stage = this.stagesRepo.create({ customerId, label, color, position: (max as number) + 1, triggersConversion, isEntryStage });
    return this.stagesRepo.save(stage);
  }

  async update(
    id: number,
    data: { label?: string; color?: string; triggersConversion?: boolean; isEntryStage?: boolean },
    tenantId: string | null,
  ): Promise<CrmStage> {
    const where = tenantId ? { id, customerId: tenantId } : { id };
    const stage = await this.stagesRepo.findOne({ where });
    if (!stage) throw new NotFoundException('Etapa não encontrada');

    const oldLabel = stage.label;

    if (data.label !== undefined) stage.label = data.label;
    if (data.color !== undefined) stage.color = data.color;
    if (data.triggersConversion !== undefined) stage.triggersConversion = data.triggersConversion;
    if (data.isEntryStage !== undefined) {
      // Só uma etapa de entrada por cliente — marcar esta desmarca as outras
      if (data.isEntryStage) await this.clearEntryStage(stage.customerId, id);
      stage.isEntryStage = data.isEntryStage;
    }

    const saved = await this.stagesRepo.save(stage);

    // Atualiza leads que tinham a etapa renomeada
    if (data.label && data.label !== oldLabel) {
      await this.leadsRepo.update(
        { customerId: stage.customerId, status: oldLabel },
        { status: data.label },
      );
    }

    return saved;
  }

  /** Remove a marcação de entrada de todas as etapas do cliente (exceto a informada) */
  private async clearEntryStage(customerId: string, exceptId?: number): Promise<void> {
    const where = exceptId ? { customerId, isEntryStage: true, id: Not(exceptId) } : { customerId, isEntryStage: true };
    await this.stagesRepo.update(where, { isEntryStage: false });
  }

  async reorder(customerId: string, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, idx) => this.stagesRepo.update({ id, customerId }, { position: idx })),
    );
  }

  async delete(id: number, tenantId: string | null): Promise<void> {
    const where = tenantId ? { id, customerId: tenantId } : { id };
    const stage = await this.stagesRepo.findOne({ where });
    if (!stage) throw new NotFoundException('Etapa não encontrada');

    // Nunca excluir uma etapa que ainda tem leads — força mover/excluir os leads antes
    const leadCount = await this.leadsRepo.count({
      where: { customerId: stage.customerId, status: stage.label },
    });
    if (leadCount > 0) {
      throw new ConflictException(
        `Não é possível excluir: esta etapa tem ${leadCount} lead(s). Mova-os para outra etapa antes de excluir.`,
      );
    }

    await this.stagesRepo.delete(id);
  }
}
