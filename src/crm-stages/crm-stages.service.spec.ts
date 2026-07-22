import { ForbiddenException } from '@nestjs/common';
import { CrmStagesService } from './crm-stages.service';
import { CrmStage } from './crm-stage.entity';

/** Ganho/Perdido são colunas fixas — não podem ser renomeadas, excluídas, nem perder o comportamento fixo. */
describe('CrmStagesService — imutabilidade das etapas Ganho/Perdido', () => {
  let service: CrmStagesService;
  let stagesRepo: { findOne: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let leadsRepo: { count: jest.Mock; update: jest.Mock };

  const wonStage: CrmStage = {
    id: 1, customerId: 'c1', label: 'Ganho', color: '#22c55e',
    position: 2, triggersConversion: true, isEntryStage: false, code: 'ABC123', kind: 'won',
  };
  const defaultStage: CrmStage = {
    id: 2, customerId: 'c1', label: 'Em Atendimento', color: '#f59e0b',
    position: 1, triggersConversion: false, isEntryStage: false, code: 'DEF456', kind: 'default',
  };

  beforeEach(() => {
    stagesRepo = {
      findOne: jest.fn(),
      save: jest.fn((s) => Promise.resolve(s)),
      delete: jest.fn(),
    };
    leadsRepo = { count: jest.fn().mockResolvedValue(0), update: jest.fn() };
    service = new CrmStagesService(stagesRepo as any, leadsRepo as any);
  });

  it('bloqueia renomear a etapa Ganho', async () => {
    stagesRepo.findOne.mockResolvedValue({ ...wonStage });
    await expect(service.update(1, { label: 'Novo Nome' }, 'c1')).rejects.toThrow(ForbiddenException);
  });

  it('bloqueia desativar triggersConversion na etapa Ganho', async () => {
    stagesRepo.findOne.mockResolvedValue({ ...wonStage });
    await expect(service.update(1, { triggersConversion: false }, 'c1')).rejects.toThrow(ForbiddenException);
  });

  it('bloqueia marcar a etapa Ganho como etapa de entrada', async () => {
    stagesRepo.findOne.mockResolvedValue({ ...wonStage });
    await expect(service.update(1, { isEntryStage: true }, 'c1')).rejects.toThrow(ForbiddenException);
  });

  it('permite trocar a cor da etapa Ganho', async () => {
    stagesRepo.findOne.mockResolvedValue({ ...wonStage });
    const result = await service.update(1, { color: '#000000' }, 'c1');
    expect(result.color).toBe('#000000');
  });

  it('bloqueia excluir a etapa Ganho mesmo vazia', async () => {
    stagesRepo.findOne.mockResolvedValue({ ...wonStage });
    await expect(service.delete(1, 'c1')).rejects.toThrow(ForbiddenException);
    expect(leadsRepo.count).not.toHaveBeenCalled();
  });

  it('permite renomear uma etapa normal (kind default)', async () => {
    stagesRepo.findOne.mockResolvedValue({ ...defaultStage });
    const result = await service.update(2, { label: 'Renomeada' }, 'c1');
    expect(result.label).toBe('Renomeada');
  });
});
