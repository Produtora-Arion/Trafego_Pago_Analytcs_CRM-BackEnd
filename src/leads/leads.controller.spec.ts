import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

/**
 * Teste de regressão do vazamento cross-tenant encontrado em auditoria:
 * o SupabaseAuthGuard tentava preencher req.query.customerId quando o
 * cliente omitia o parâmetro, mas no Express 5 essa escrita não persiste
 * (req.query é um getter recalculado da URL) — então GET /leads sem
 * customerId devolvia leads de QUALQUER cliente. A correção faz cada
 * controller resolver o customerId direto de req.user.customerId (nunca
 * do query/body), então estes testes fixam esse contrato pra sempre.
 */
describe('LeadsController — isolamento multi-tenant', () => {
  let controller: LeadsController;
  let leadsService: { findAll: jest.Mock; upsertFromWebhook: jest.Mock };

  const CLIENT_OWN = '1111111111';
  const OTHER_CUSTOMER = '2222222222';

  const clientReq = { user: { role: 'client', customerId: CLIENT_OWN } };
  const adminReq = { user: { role: 'admin', customerId: null } };

  beforeEach(async () => {
    leadsService = {
      findAll: jest.fn().mockResolvedValue([]),
      upsertFromWebhook: jest.fn().mockImplementation((dto) => Promise.resolve(dto)),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [
        { provide: LeadsService, useValue: leadsService },
        { provide: GoogleAdsService, useValue: {} },
        { provide: CrmStagesService, useValue: {} },
        { provide: WebhookConfigService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    })
      // O guard exige SUPABASE_URL/SECRET_KEY reais pra construir — aqui testamos
      // só a lógica do controller (resolução de customerId), não a autenticação.
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(LeadsController);
  });

  it('cliente sem customerId na query recebe só os próprios leads', async () => {
    await controller.findAll(undefined, clientReq);
    expect(leadsService.findAll).toHaveBeenCalledWith(CLIENT_OWN);
  });

  it('cliente que tenta pedir o customerId de outro cliente é ignorado — sempre usa o próprio', async () => {
    await controller.findAll(OTHER_CUSTOMER, clientReq);
    expect(leadsService.findAll).toHaveBeenCalledWith(CLIENT_OWN);
  });

  it('admin sem customerId vê todos os leads (sem filtro)', async () => {
    await controller.findAll(undefined, adminReq);
    expect(leadsService.findAll).toHaveBeenCalledWith(undefined);
  });

  it('admin com customerId explícito filtra por aquele cliente', async () => {
    await controller.findAll(OTHER_CUSTOMER, adminReq);
    expect(leadsService.findAll).toHaveBeenCalledWith(OTHER_CUSTOMER);
  });

  it('cliente criando lead sem customerId no body é forçado pro próprio', async () => {
    await controller.create({ name: 'Teste' } as any, clientReq);
    expect(leadsService.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CLIENT_OWN }),
    );
  });

  it('cliente tentando criar lead pra outro customerId é sobrescrito pro próprio', async () => {
    await controller.create({ name: 'Teste', customerId: OTHER_CUSTOMER } as any, clientReq);
    expect(leadsService.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CLIENT_OWN }),
    );
  });

  it('admin criando lead com customerId explícito preserva o valor informado', async () => {
    await controller.create({ name: 'Teste', customerId: OTHER_CUSTOMER } as any, adminReq);
    expect(leadsService.upsertFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: OTHER_CUSTOMER }),
    );
  });
});
