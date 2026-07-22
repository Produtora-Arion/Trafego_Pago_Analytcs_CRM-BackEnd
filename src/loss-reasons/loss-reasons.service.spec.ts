import { ConflictException } from '@nestjs/common';
import { LossReasonsService } from './loss-reasons.service';
import { LossReason } from './loss-reason.entity';

describe('LossReasonsService — exclusão só quando não há leads usando o motivo', () => {
  let service: LossReasonsService;
  let repo: { findOne: jest.Mock; delete: jest.Mock };
  let leadsRepo: { count: jest.Mock };

  const reason: LossReason = { id: 1, customerId: 'c1', label: 'Sem orçamento', active: true, createdAt: new Date() };

  beforeEach(() => {
    repo = { findOne: jest.fn().mockResolvedValue({ ...reason }), delete: jest.fn() };
    leadsRepo = { count: jest.fn() };
    service = new LossReasonsService(repo as any, leadsRepo as any);
  });

  it('bloqueia excluir um motivo em uso por leads', async () => {
    leadsRepo.count.mockResolvedValue(3);
    await expect(service.delete(1, 'c1')).rejects.toThrow(ConflictException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('permite excluir um motivo sem nenhum lead vinculado', async () => {
    leadsRepo.count.mockResolvedValue(0);
    await service.delete(1, 'c1');
    expect(repo.delete).toHaveBeenCalledWith(1);
  });
});
