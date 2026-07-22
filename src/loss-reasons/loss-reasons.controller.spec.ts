import { Test, TestingModule } from '@nestjs/testing';
import { LossReasonsController } from './loss-reasons.controller';
import { LossReasonsService } from './loss-reasons.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

/** Mesmo contrato de isolamento testado em crm-stages.controller.spec.ts. */
describe('LossReasonsController — isolamento multi-tenant', () => {
  let controller: LossReasonsController;
  let service: { findAll: jest.Mock; create: jest.Mock };

  const CLIENT_OWN = '1111111111';
  const OTHER_CUSTOMER = '2222222222';
  const clientReq = { user: { role: 'client', customerId: CLIENT_OWN } };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LossReasonsController],
      providers: [{ provide: LossReasonsService, useValue: service }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(LossReasonsController);
  });

  it('cliente sem customerId na query recebe só os próprios motivos', async () => {
    await controller.findAll(undefined as any, clientReq);
    expect(service.findAll).toHaveBeenCalledWith(CLIENT_OWN);
  });

  it('cliente tentando listar motivos de outro cliente é ignorado', async () => {
    await controller.findAll(OTHER_CUSTOMER, clientReq);
    expect(service.findAll).toHaveBeenCalledWith(CLIENT_OWN);
  });

  it('cliente criando motivo pra outro customerId é forçado pro próprio', async () => {
    await controller.create({ customerId: OTHER_CUSTOMER, label: 'Sem orçamento' }, clientReq);
    expect(service.create).toHaveBeenCalledWith(CLIENT_OWN, 'Sem orçamento');
  });
});
