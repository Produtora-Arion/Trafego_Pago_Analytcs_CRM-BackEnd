import { LeadsService } from './leads.service';
import { Lead } from './lead.entity';

/** Motivo de perda só faz sentido enquanto o lead está na etapa fixa "Perdido". */
describe('LeadsService — motivo de perda desatribuído ao sair de "Perdido"', () => {
  let service: LeadsService;
  let repo: { findOne: jest.Mock; save: jest.Mock };

  const lostLead: Lead = {
    id: 1, customerId: 'c1', stageId: 12, status: 'Perdido', lossReasonId: 7,
  } as Lead;

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue({ ...lostLead }),
      save: jest.fn((l) => Promise.resolve(l)),
    };
    service = new LeadsService(repo as any);
  });

  it('updateStage() limpa lossReasonId ao mover o lead pra qualquer outra etapa', async () => {
    const result = await service.updateStage(1, 6, 'Em Atendimento', 'c1');
    expect(result.lossReasonId).toBeNull();
  });

  it('markConverted() limpa lossReasonId ao mover o lead pra Ganho', async () => {
    const result = await service.markConverted(1, 500, 'c1', 'action-1', 'c1', 7, 'Ganho');
    expect(result.lossReasonId).toBeNull();
  });

  it('markLost() atribui o lossReasonId informado', async () => {
    const result = await service.markLost(1, 12, 'Perdido', 9, 'c1');
    expect(result.lossReasonId).toBe(9);
  });
});
