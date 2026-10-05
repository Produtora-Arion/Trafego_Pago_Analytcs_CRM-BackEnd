import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MonthlyReport } from './monthly-report.entity';
import { ReportCampaignSelection } from './report-campaign-selection.entity';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { MetaAdsService } from '../meta-ads/meta-ads.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { LeadsService } from '../leads/leads.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';
import { LossReasonsService } from '../loss-reasons/loss-reasons.service';

interface DailyRow {
  data: string; // YYYY-MM-DD
  impressoes: number;
  cliques: number;
  custo: number;
  conversoes: number;
}

interface WeekBucket {
  label: string;
  de: string;
  ate: string;
  impressoes: number;
  cliques: number;
  custo: number;
  conversoes: number;
  ctr: string;
  cpc_medio: string;
  custo_por_conversao: string;
  leads_recebidos: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(MonthlyReport) private readonly repo: Repository<MonthlyReport>,
    @InjectRepository(ReportCampaignSelection) private readonly selectionRepo: Repository<ReportCampaignSelection>,
    private readonly googleAds: GoogleAdsService,
    private readonly meta: MetaAdsService,
    private readonly webhookConfig: WebhookConfigService,
    private readonly leads: LeadsService,
    private readonly crmStages: CrmStagesService,
    private readonly lossReasons: LossReasonsService,
  ) {}

  // ─── Seleção de campanhas (configurada uma vez por cliente) ───────────────

  async getSelection(customerId: string): Promise<ReportCampaignSelection[]> {
    return this.selectionRepo.find({ where: { customerId } });
  }

  /** Lista as campanhas disponíveis pra escolher — Google e/ou Meta, o que o cliente tiver configurado. */
  async getCampaignOptions(customerId: string): Promise<{ google: any[]; meta: any[] }> {
    const [google, meta] = await Promise.all([
      this.googleAds.listCampaigns(customerId, 'LAST_30_DAYS').catch(() => []),
      this.getMetaCampaignOptions(customerId).catch(() => []),
    ]);
    return { google, meta };
  }

  private async getMetaCampaignOptions(customerId: string): Promise<any[]> {
    const { accessToken, adAccountId } = await this.webhookConfig.getMetaConfig(customerId);
    if (!accessToken || !adAccountId) return [];
    return this.meta.listCampaigns(accessToken, adAccountId, 'LAST_30_DAYS');
  }

  /** Substitui a seleção inteira do cliente — mais simples que editar item a item. */
  async saveSelection(
    customerId: string,
    items: { platform: 'google' | 'meta'; campaignId: string; campaignName?: string; accountId?: string }[],
  ): Promise<ReportCampaignSelection[]> {
    await this.selectionRepo.delete({ customerId });
    if (items.length === 0) return [];
    const rows = items.map((i) =>
      this.selectionRepo.create({
        customerId,
        platform: i.platform,
        campaignId: i.campaignId,
        campaignName: i.campaignName ?? null,
        accountId: i.accountId ?? null,
      }),
    );
    return this.selectionRepo.save(rows);
  }

  // ─── Geração (calcula na hora, não salva) ──────────────────────────────────

  async generate(customerId: string, month: string): Promise<any> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month deve estar no formato YYYY-MM');

    const monthStart = `${month}-01`;
    const end = new Date(`${month}-01T00:00:00.000Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(end.getUTCDate() - 1);
    const monthEnd = end.toISOString().slice(0, 10);
    const dateRange = `CUSTOM:${monthStart}:${monthEnd}`;

    // 1. Resolve quais campanhas entram — seleção salva, ou (sem seleção) todas as ativas do mês.
    const selection = await this.getSelection(customerId);
    let googleCampaigns = selection.filter((s) => s.platform === 'google');
    let metaCampaigns = selection.filter((s) => s.platform === 'meta');

    if (selection.length === 0) {
      const options = await this.getCampaignOptions(customerId);
      googleCampaigns = options.google
        .filter((c: any) => c.status === 'ENABLED')
        .map((c: any) => this.selectionRepo.create({ customerId, platform: 'google' as const, campaignId: c.id, campaignName: c.nome }));
      metaCampaigns = options.meta
        .filter((c: any) => c.status === 'ACTIVE')
        .map((c: any) => this.selectionRepo.create({ customerId, platform: 'meta' as const, campaignId: c.id, campaignName: c.nome }));
    }

    // 2. Busca dado dia a dia das campanhas selecionadas.
    const [googleDaily, metaDaily] = await Promise.all([
      googleCampaigns.length
        ? this.googleAds.getCampaignMetricsDaily(customerId, googleCampaigns.map((c) => c.campaignId), dateRange)
        : Promise.resolve([]),
      this.fetchMetaDaily(customerId, metaCampaigns, dateRange),
    ]);

    const allDaily: DailyRow[] = [...googleDaily, ...metaDaily];

    // 3. Agrupa em semanas fixas de 7 dias a partir do dia 1 (semana 1: 1-7, semana 2: 8-14...).
    const semanas = this.bucketIntoWeeks(allDaily, month, monthEnd);

    // 4. Totais do mês inteiro.
    const totais = this.sumRows(allDaily);

    // 5. Dado do CRM — leads recebidos (por semana, já embutido acima), etapa final e motivo de perda.
    const [leadsDoMes, stages, reasons] = await Promise.all([
      this.leads.findInMonth(customerId, month),
      this.crmStages.findAll(customerId),
      this.lossReasons.findAll(customerId),
    ]);

    for (const semana of semanas) {
      semana.leads_recebidos = leadsDoMes.filter((l) => {
        const d = l.firstContactAt.toISOString().slice(0, 10);
        return d >= semana.de && d <= semana.ate;
      }).length;
    }

    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const reasonMap = new Map(reasons.map((r) => [r.id, r]));
    const porEtapa = new Map<string, number>();
    const porMotivoPerda = new Map<string, number>();
    let qualificados = 0;
    let ganhos = 0;
    for (const lead of leadsDoMes) {
      const stage = lead.stageId !== null ? stageMap.get(lead.stageId) : undefined;
      const label = stage?.label ?? '(etapa removida)';
      porEtapa.set(label, (porEtapa.get(label) ?? 0) + 1);
      if (stage?.kind === 'won') ganhos++;
      if (lead.formConversionUploadedAt) qualificados++;
      if (stage?.kind === 'lost' && lead.lossReasonId) {
        const reason = reasonMap.get(lead.lossReasonId);
        const label2 = reason?.label ?? '(motivo removido)';
        porMotivoPerda.set(label2, (porMotivoPerda.get(label2) ?? 0) + 1);
      }
    }

    const funil = {
      total_leads: leadsDoMes.length,
      leads_qualificados: qualificados,
      ganhos,
      por_etapa: Array.from(porEtapa.entries()).map(([etapa, quantidade]) => ({ etapa, quantidade })),
      motivos_de_perda: Array.from(porMotivoPerda.entries()).map(([motivo, quantidade]) => ({ motivo, quantidade })),
    };

    const insights = this.buildInsights(semanas, funil);

    const campanhas = [
      ...googleCampaigns.map((c) => ({ plataforma: 'Google Ads', nome: c.campaignName ?? c.campaignId })),
      ...metaCampaigns.map((c) => ({ plataforma: 'Meta Ads', nome: c.campaignName ?? c.campaignId })),
    ];

    return { mes: month, campanhas, semanas, totais, funil, insights };
  }

  private async fetchMetaDaily(
    customerId: string,
    metaCampaigns: { campaignId: string; accountId?: string | null }[],
    dateRange: string,
  ): Promise<DailyRow[]> {
    if (metaCampaigns.length === 0) return [];
    const { accessToken, adAccountId } = await this.webhookConfig.getMetaConfig(customerId);
    const accountId = metaCampaigns[0].accountId ?? adAccountId;
    if (!accessToken || !accountId) return [];
    return this.meta.getCampaignInsightsDaily(accessToken, accountId, metaCampaigns.map((c) => c.campaignId), dateRange);
  }

  private bucketIntoWeeks(rows: DailyRow[], month: string, monthEnd: string): WeekBucket[] {
    const lastDay = Number(monthEnd.slice(-2));
    const weeks: WeekBucket[] = [];
    for (let start = 1; start <= lastDay; start += 7) {
      const endDay = Math.min(start + 6, lastDay);
      const de = `${month}-${String(start).padStart(2, '0')}`;
      const ate = `${month}-${String(endDay).padStart(2, '0')}`;
      weeks.push({
        label: `Semana ${weeks.length + 1} (${String(start).padStart(2, '0')}-${String(endDay).padStart(2, '0')})`,
        de, ate,
        impressoes: 0, cliques: 0, custo: 0, conversoes: 0,
        ctr: '0.00%', cpc_medio: 'R$ 0,00', custo_por_conversao: 'Sem conversões',
        leads_recebidos: 0,
      });
    }
    for (const row of rows) {
      const week = weeks.find((w) => row.data >= w.de && row.data <= w.ate);
      if (!week) continue;
      week.impressoes += row.impressoes;
      week.cliques += row.cliques;
      week.custo += row.custo;
      week.conversoes += row.conversoes;
    }
    for (const week of weeks) {
      week.ctr = week.impressoes > 0 ? `${((week.cliques / week.impressoes) * 100).toFixed(2)}%` : '0.00%';
      week.cpc_medio = week.cliques > 0 ? `R$ ${(week.custo / week.cliques).toFixed(2)}` : 'R$ 0,00';
      week.custo_por_conversao = week.conversoes > 0 ? `R$ ${(week.custo / week.conversoes).toFixed(2)}` : 'Sem conversões';
      week.custo = Number(week.custo.toFixed(2));
    }
    return weeks;
  }

  private sumRows(rows: DailyRow[]) {
    const t = { impressoes: 0, cliques: 0, custo: 0, conversoes: 0 };
    for (const r of rows) {
      t.impressoes += r.impressoes; t.cliques += r.cliques; t.custo += r.custo; t.conversoes += r.conversoes;
    }
    return {
      ...t,
      custo: Number(t.custo.toFixed(2)),
      ctr: t.impressoes > 0 ? `${((t.cliques / t.impressoes) * 100).toFixed(2)}%` : '0.00%',
      cpc_medio: t.cliques > 0 ? `R$ ${(t.custo / t.cliques).toFixed(2)}` : 'R$ 0,00',
      custo_por_conversao: t.conversoes > 0 ? `R$ ${(t.custo / t.conversoes).toFixed(2)}` : 'Sem conversões',
    };
  }

  /** Comparações calculadas em cima do dado real — nunca texto inventado. */
  private buildInsights(semanas: WeekBucket[], funil: { total_leads: number; leads_qualificados: number }): string {
    const comSpend = semanas.filter((s) => s.custo > 0);
    if (comSpend.length === 0) return 'Sem gasto registrado neste período.';

    const linhas: string[] = [];
    const maisCara = [...comSpend].sort((a, b) => b.custo - a.custo)[0];
    const maisBarata = [...comSpend].sort((a, b) => a.custo - b.custo)[0];
    linhas.push(`${maisCara.label} teve o maior investimento (R$ ${maisCara.custo.toFixed(2)}).`);
    if (maisBarata.label !== maisCara.label) {
      linhas.push(`${maisBarata.label} teve o menor investimento (R$ ${maisBarata.custo.toFixed(2)}).`);
    }

    const comConversao = comSpend.filter((s) => s.conversoes > 0);
    if (comConversao.length > 0) {
      const melhorCusto = [...comConversao].sort((a, b) => (a.custo / a.conversoes) - (b.custo / b.conversoes))[0];
      linhas.push(`${melhorCusto.label} teve o melhor custo por conversão (${melhorCusto.custo_por_conversao}).`);
    }
    const semConversao = comSpend.filter((s) => s.conversoes === 0);
    if (semConversao.length > 0) {
      linhas.push(`${semConversao.map((s) => s.label).join(', ')} não registrou nenhuma conversão apesar do investimento.`);
    }

    if (funil.total_leads > 0) {
      const taxa = ((funil.leads_qualificados / funil.total_leads) * 100).toFixed(0);
      linhas.push(`Dos ${funil.total_leads} leads recebidos no mês, ${funil.leads_qualificados} (${taxa}%) foram confirmados como contatos qualificados pela equipe.`);
    }

    return linhas.join(' ');
  }

  // ─── CRUD dos relatórios salvos ─────────────────────────────────────────

  async create(customerId: string, month: string, data: any, observations: string | null): Promise<MonthlyReport> {
    const campaignNames = data.campanhas.map((c: any) => `${c.plataforma}: ${c.nome}`).join(', ') || 'Nenhuma campanha';
    const report = this.repo.create({
      customerId, month,
      campaignNames,
      summaryData: JSON.stringify(data),
      autoInsights: data.insights,
      observations,
      releasedToClient: false,
      releasedAt: null,
    });
    return this.repo.save(report);
  }

  /** Admin vê tudo; cliente só vê os liberados — o filtro é aqui, nunca confiado ao frontend. */
  async findAll(customerId: string, isAdmin: boolean): Promise<MonthlyReport[]> {
    const where: any = { customerId };
    if (!isAdmin) where.releasedToClient = true;
    return this.repo.find({ where, order: { month: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: number, customerId: string, isAdmin: boolean): Promise<MonthlyReport> {
    const report = await this.repo.findOne({ where: { id, customerId } });
    if (!report) throw new NotFoundException('Relatório não encontrado');
    if (!isAdmin && !report.releasedToClient) throw new ForbiddenException('Este relatório ainda não foi liberado');
    return report;
  }

  async updateObservations(id: number, customerId: string, observations: string): Promise<MonthlyReport> {
    const report = await this.repo.findOne({ where: { id, customerId } });
    if (!report) throw new NotFoundException('Relatório não encontrado');
    report.observations = observations;
    report.updatedAt = new Date();
    return this.repo.save(report);
  }

  async setReleased(id: number, customerId: string, released: boolean): Promise<MonthlyReport> {
    const report = await this.repo.findOne({ where: { id, customerId } });
    if (!report) throw new NotFoundException('Relatório não encontrado');
    report.releasedToClient = released;
    report.releasedAt = released ? new Date() : null;
    return this.repo.save(report);
  }

  async delete(id: number, customerId: string): Promise<void> {
    const result = await this.repo.delete({ id, customerId });
    if (result.affected === 0) throw new NotFoundException('Relatório não encontrado');
  }
}
