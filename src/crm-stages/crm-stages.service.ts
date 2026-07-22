import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { CrmStage } from './crm-stage.entity';
import { Lead } from '../leads/lead.entity';

// Sem 0/O/1/I/L — evita confusão visual ao ler o código
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código curto e aleatório (6 chars) — identificador visível e imutável, gerado só na criação da etapa. */
function generateStageCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

const DEFAULT_STAGES = [
  { label: 'Novo',           color: '#0ea5e9', position: 0, triggersConversion: false, isEntryStage: true,  kind: 'default' as const },
  { label: 'Em Atendimento', color: '#f59e0b', position: 1, triggersConversion: false, isEntryStage: false, kind: 'default' as const },
  { label: 'Ganho',          color: '#22c55e', position: 2, triggersConversion: true,  isEntryStage: false, kind: 'won' as const },
  { label: 'Perdido',        color: '#ef4444', position: 3, triggersConversion: false, isEntryStage: false, kind: 'lost' as const },
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
        DEFAULT_STAGES.map(s => this.stagesRepo.save(this.stagesRepo.create({ ...s, customerId, code: generateStageCode() }))),
      );
      return created.sort((a, b) => a.position - b.position);
    }

    // Auto-cura: cliente já tem etapas mas falta Ganho e/ou Perdido (ex: conta
    // criada antes dessas colunas existirem) — cria só a(s) que faltam, no fim.
    const missingKinds = (['won', 'lost'] as const).filter(k => !stages.some(s => s.kind === k));
    if (missingKinds.length > 0) {
      const maxPos = Math.max(...stages.map(s => s.position), -1);
      const toCreate = missingKinds.map((k, i) => {
        const def = DEFAULT_STAGES.find(s => s.kind === k)!;
        return this.stagesRepo.create({ ...def, position: maxPos + 1 + i, customerId, code: generateStageCode() });
      });
      const created = await Promise.all(toCreate.map(s => this.stagesRepo.save(s)));
      return [...stages, ...created].sort((a, b) => a.position - b.position);
    }

    return stages;
  }

  /**
   * Busca uma etapa pelo seu ID imutável, respeitando o isolamento por tenant
   * (cliente só resolve etapas da própria conta). Usado pelo LeadsController
   * para validar/traduzir o stageId recebido nas rotas de mover/converter lead.
   */
  async findById(id: number, tenantId: string | null): Promise<CrmStage> {
    const where = tenantId ? { id, customerId: tenantId } : { id };
    const stage = await this.stagesRepo.findOne({ where });
    if (!stage) throw new NotFoundException('Etapa não encontrada');
    return stage;
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
    const stage = this.stagesRepo.create({ customerId, label, color, position: (max as number) + 1, triggersConversion, isEntryStage, code: generateStageCode() });
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

    // Ganho/Perdido são colunas fixas do funil: nome, disparo de conversão
    // (sempre ligado em Ganho) e etapa de entrada não podem ser alterados.
    // Cor continua livre — não faz diferença estrutural nenhuma.
    if (stage.kind !== 'default') {
      if (data.label !== undefined && data.label !== stage.label) {
        throw new ForbiddenException('Esta etapa é fixa e não pode ser renomeada');
      }
      if (data.isEntryStage) {
        throw new ForbiddenException('Esta etapa é fixa e não pode ser a etapa de entrada');
      }
      if (stage.kind === 'won' && data.triggersConversion === false) {
        throw new ForbiddenException('A etapa Ganho sempre dispara a conversão — não é possível desativar');
      }
    }

    const labelChanged = data.label !== undefined && data.label !== stage.label;

    if (data.label !== undefined) stage.label = data.label;
    if (data.color !== undefined) stage.color = data.color;
    if (data.triggersConversion !== undefined) stage.triggersConversion = data.triggersConversion;
    if (data.isEntryStage !== undefined) {
      // Só uma etapa de entrada por cliente — marcar esta desmarca as outras
      if (data.isEntryStage) await this.clearEntryStage(stage.customerId, id);
      stage.isEntryStage = data.isEntryStage;
    }

    const saved = await this.stagesRepo.save(stage);

    // Atualiza o rótulo (denormalizado, só para exibição) dos leads desta etapa.
    // Casa por stageId (imutável) — nunca por nome, então renomear nunca "perde"
    // ou mistura leads, mesmo que dois nomes se pareçam ou colidam temporariamente.
    if (labelChanged) {
      await this.leadsRepo.update({ stageId: stage.id }, { status: data.label! });
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

    if (stage.kind !== 'default') {
      throw new ForbiddenException('Esta etapa é fixa e não pode ser excluída');
    }

    // Nunca excluir uma etapa que ainda tem leads — força mover/excluir os leads antes.
    // Casa por stageId (imutável), não por nome.
    const leadCount = await this.leadsRepo.count({ where: { stageId: stage.id } });
    if (leadCount > 0) {
      throw new ConflictException(
        `Não é possível excluir: esta etapa tem ${leadCount} lead(s). Mova-os para outra etapa antes de excluir.`,
      );
    }

    await this.stagesRepo.delete(id);
  }
}
