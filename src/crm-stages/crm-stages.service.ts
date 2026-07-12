import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CrmStage } from './crm-stage.entity';
import { Lead } from '../leads/lead.entity';

const DEFAULT_STAGES = [
  { label: 'Novo',           color: '#0ea5e9', position: 0, triggersConversion: false },
  { label: 'Em Atendimento', color: '#f59e0b', position: 1, triggersConversion: false },
  { label: 'Convertido',     color: '#22c55e', position: 2, triggersConversion: true  },
  { label: 'Perdido',        color: '#ef4444', position: 3, triggersConversion: false },
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

  async create(customerId: string, label: string, color: string, triggersConversion: boolean): Promise<CrmStage> {
    const max = await this.stagesRepo.maximum('position', { customerId }) ?? -1;
    const stage = this.stagesRepo.create({ customerId, label, color, position: (max as number) + 1, triggersConversion });
    return this.stagesRepo.save(stage);
  }

  async update(id: number, data: { label?: string; color?: string; triggersConversion?: boolean }): Promise<CrmStage> {
    const stage = await this.stagesRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('Etapa não encontrada');

    const oldLabel = stage.label;

    if (data.label !== undefined) stage.label = data.label;
    if (data.color !== undefined) stage.color = data.color;
    if (data.triggersConversion !== undefined) stage.triggersConversion = data.triggersConversion;

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

  async reorder(customerId: string, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, idx) => this.stagesRepo.update({ id, customerId }, { position: idx })),
    );
  }

  async delete(id: number): Promise<void> {
    const stage = await this.stagesRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('Etapa não encontrada');

    // Move leads desta etapa para a primeira etapa restante
    const remaining = await this.stagesRepo.findOne({
      where: { customerId: stage.customerId, id: Not(id) },
      order: { position: 'ASC' },
    });

    if (remaining) {
      await this.leadsRepo.update(
        { customerId: stage.customerId, status: stage.label },
        { status: remaining.label },
      );
    }

    await this.stagesRepo.delete(id);
  }
}
