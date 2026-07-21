import { Test, TestingModule } from '@nestjs/testing';
import { CrmStagesController } from './crm-stages.controller';
import { CrmStagesService } from './crm-stages.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

/** Mesmo contrato de isolamento testado em leads.controller.spec.ts, aplicado às etapas do CRM. */
describe('CrmStagesController — isolamento multi-tenant', () => {
  let controller: CrmStagesController;
  let service: { findAll: jest.Mock; create: jest.Mock; reorder: jest.Mock };

  const CLIENT_OWN = '1111111111';
  const OTHER_CUSTOMER = '2222222222';
  const clientReq = { user: { role: 'client', customerId: CLIENT_OWN } };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      reorder: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CrmStagesController],
      providers: [{ provide: CrmStagesService, useValue: service }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CrmStagesController);
  });

  it('cliente sem customerId na query recebe só as próprias etapas', async () => {
    await controller.findAll(undefined as any, clientReq);
    expect(service.findAll).toHaveBeenCalledWith(CLIENT_OWN);
  });

  it('cliente tentando listar etapas de outro cliente é ignorado', async () => {
    await controller.findAll(OTHER_CUSTOMER, clientReq);
    expect(service.findAll).toHaveBeenCalledWith(CLIENT_OWN);
  });

  it('cliente criando etapa pra outro customerId é forçado pro próprio', async () => {
    await controller.create({ customerId: OTHER_CUSTOMER, label: 'Nova', color: '#000' }, clientReq);
    expect(service.create).toHaveBeenCalledWith(CLIENT_OWN, 'Nova', '#000', false, false);
  });

  it('cliente reordenando etapas é forçado pro próprio customerId', async () => {
    await controller.reorder({ customerId: OTHER_CUSTOMER, orderedIds: [1, 2, 3] }, clientReq);
    expect(service.reorder).toHaveBeenCalledWith(CLIENT_OWN, [1, 2, 3]);
  });
});
