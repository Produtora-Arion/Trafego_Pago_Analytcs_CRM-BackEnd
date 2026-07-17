import { Injectable } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleAdsService } from '../google-ads/google-ads.service';

@Injectable()
export class McpService {
  private server: Server;

  constructor(private readonly googleAds: GoogleAdsService) {
    this.server = new Server(
      { name: 'google-ads-arion', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    this.registerTools();
  }

  private registerTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'listar_contas',
          description:
            'Lista todas as contas de anúncio gerenciadas pela MCC Produtora Arion.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'visao_geral_conta',
          description:
            'Retorna métricas consolidadas de uma conta Google Ads (impressões, cliques, custo, CTR, conversões).',
          inputSchema: {
            type: 'object',
            properties: {
              customer_id: {
                type: 'string',
                description: 'ID da conta Google Ads (ex: 1234567890)',
              },
              periodo: {
                type: 'string',
                description:
                  'Período de análise. Valores: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH',
                default: 'LAST_7_DAYS',
              },
            },
            required: ['customer_id'],
          },
        },
        {
          name: 'listar_campanhas',
          description:
            'Lista todas as campanhas ativas de uma conta com suas métricas de desempenho.',
          inputSchema: {
            type: 'object',
            properties: {
              customer_id: {
                type: 'string',
                description: 'ID da conta Google Ads',
              },
              periodo: {
                type: 'string',
                description:
                  'Período de análise. Valores: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH',
                default: 'LAST_7_DAYS',
              },
            },
            required: ['customer_id'],
          },
        },
        {
          name: 'detalhes_campanha',
          description:
            'Retorna análise detalhada de uma campanha específica, incluindo parcela de impressões e perdas por orçamento/ranking.',
          inputSchema: {
            type: 'object',
            properties: {
              customer_id: {
                type: 'string',
                description: 'ID da conta Google Ads',
              },
              campaign_id: {
                type: 'string',
                description: 'ID da campanha',
              },
              periodo: {
                type: 'string',
                description:
                  'Período de análise. Valores: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH',
                default: 'LAST_7_DAYS',
              },
            },
            required: ['customer_id', 'campaign_id'],
          },
        },
        {
          name: 'listar_grupos_anuncio',
          description:
            'Lista os grupos de anúncio de uma campanha com suas métricas.',
          inputSchema: {
            type: 'object',
            properties: {
              customer_id: {
                type: 'string',
                description: 'ID da conta Google Ads',
              },
              campaign_id: {
                type: 'string',
                description: 'ID da campanha',
              },
              periodo: {
                type: 'string',
                description:
                  'Período de análise. Valores: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH',
                default: 'LAST_7_DAYS',
              },
            },
            required: ['customer_id', 'campaign_id'],
          },
        },
        {
          name: 'performance_palavras_chave',
          description:
            'Lista as palavras-chave com desempenho, índice de qualidade e custo. Pode ser filtrado por campanha.',
          inputSchema: {
            type: 'object',
            properties: {
              customer_id: {
                type: 'string',
                description: 'ID da conta Google Ads',
              },
              campaign_id: {
                type: 'string',
                description: 'ID da campanha (opcional, para filtrar)',
              },
              periodo: {
                type: 'string',
                description:
                  'Período de análise. Valores: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH',
                default: 'LAST_7_DAYS',
              },
            },
            required: ['customer_id'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let data: unknown;

        switch (name) {
          case 'listar_contas':
            data = await this.googleAds.listManagedAccounts();
            break;

          case 'visao_geral_conta':
            data = await this.googleAds.getAccountOverview(
              args.customer_id as string,
              (args.periodo as string) || 'LAST_7_DAYS',
            );
            break;

          case 'listar_campanhas':
            data = await this.googleAds.listCampaigns(
              args.customer_id as string,
              (args.periodo as string) || 'LAST_7_DAYS',
            );
            break;

          case 'detalhes_campanha':
            data = await this.googleAds.getCampaignDetails(
              args.customer_id as string,
              args.campaign_id as string,
              (args.periodo as string) || 'LAST_7_DAYS',
            );
            break;

          case 'listar_grupos_anuncio':
            data = await this.googleAds.listAdGroups(
              args.customer_id as string,
              args.campaign_id as string,
              (args.periodo as string) || 'LAST_7_DAYS',
            );
            break;

          case 'performance_palavras_chave':
            data = await this.googleAds.getKeywordPerformance(
              args.customer_id as string,
              args.campaign_id as string | undefined,
              (args.periodo as string) || 'LAST_7_DAYS',
            );
            break;

          default:
            return {
              content: [{ type: 'text', text: `Tool desconhecida: ${name}` }],
              isError: true,
            };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Erro: ${message}` }],
          isError: true,
        };
      }
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
