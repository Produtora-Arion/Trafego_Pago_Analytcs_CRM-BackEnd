import { ConflictException, ForbiddenException } from '@nestjs/common';
import { LossReasonsService } from './loss-reasons.service';
import { LossReason } from './loss-reason.entity';

describe('LossReasonsService — exclusão só quando não há leads usando o motivo', () => {
  let service: LossReasonsService;
  let repo: { findOne: jest.Mock; delete: jest.Mock };
  let leadsRepo: { count: jest.Mock };

  const reason: LossReason = { id: 1, customerId: 'c1', label: 'Sem orçamento', active: true, kind: 'default', createdAt: new Date() };

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

describe('LossReasonsService — motivos fixos (Fantasma / Lead Desqualificado) são protegidos', () => {
  let service: LossReasonsService;
  let repo: { findOne: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let leadsRepo: { count: jest.Mock };

  const fixedReason: LossReason = { id: 2, customerId: 'c1', label: 'Fantasma', active: true, kind: 'fantasma', createdAt: new Date() };

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue({ ...fixedReason }),
      save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
      delete: jest.fn(),
    };
    leadsRepo = { count: jest.fn().mockResolvedValue(0) };
    service = new LossReasonsService(repo as any, leadsRepo as any);
  });

  it('bloqueia renomear um motivo fixo', async () => {
    await expect(service.update(2, { label: 'Outro nome' }, 'c1')).rejects.toThrow(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('bloqueia desativar um motivo fixo', async () => {
    await expect(service.update(2, { active: false }, 'c1')).rejects.toThrow(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('bloqueia excluir um motivo fixo, mesmo sem nenhum lead vinculado', async () => {
    await expect(service.delete(2, 'c1')).rejects.toThrow(ForbiddenException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('permite reativar (active:true) um motivo fixo — só desativar é que é bloqueado', async () => {
    const updated = await service.update(2, { active: true }, 'c1');
    expect(updated.active).toBe(true);
    expect(repo.save).toHaveBeenCalled();
  });
});
