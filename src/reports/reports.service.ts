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

    const { monthEnd, dateRange } = this.monthDateRange(month);

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

    // 2. Busca dado dia a dia das campanhas selecionadas, demográficos (só Google — Meta
    // não entra aqui) e os 2 meses anteriores (só totais, pro comparativo de tendência).
    const [googleDaily, metaDaily, demograficos, mesM1, mesM2] = await Promise.all([
      googleCampaigns.length
        ? this.googleAds.getCampaignMetricsDaily(customerId, googleCampaigns.map((c) => c.campaignId), dateRange)
        : Promise.resolve([]),
      this.fetchMetaDaily(customerId, metaCampaigns, dateRange),
      googleCampaigns.length
        ? this.googleAds.getDemographicsForCampaigns(customerId, googleCampaigns.map((c) => c.campaignId), dateRange)
        : Promise.resolve({ idade: [], genero: [], renda: [] }),
      this.fetchMonthSummary(customerId, this.shiftMonth(month, -1), googleCampaigns, metaCampaigns),
      this.fetchMonthSummary(customerId, this.shiftMonth(month, -2), googleCampaigns, metaCampaigns),
    ]);

    const allDaily: DailyRow[] = [...googleDaily, ...metaDaily];

    // 3. Agrupa em semanas fixas de 7 dias a partir do dia 1 (semana 1: 1-7, semana 2: 8-14...).
    const semanas = this.bucketIntoWeeks(allDaily, month, monthEnd);

    // 4. Totais do mês inteiro.
    const totais = this.sumRows(allDaily);

    // 5. Dado do CRM — leads recebidos (por semana, já embutido acima), etapa final e motivo de perda.
    const [leadsDoMes, leadsFechadosNoMes, stages, reasons] = await Promise.all([
      this.leads.findInMonth(customerId, month),
      this.leads.findChangedInMonth(customerId, month),
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
    // Pré-popula com TODAS as etapas "em andamento" do cliente, zeradas — assim uma
    // etapa sem nenhum lead esse mês ainda aparece no relatório (com 0), igual ao
    // Fechamento do mês já faz com Ganho/Perdido.
    for (const s of stages) {
      if (s.kind === 'default') porEtapa.set(s.label, 0);
    }
    const porMotivoPerda = new Map<string, number>();
    let qualificados = 0;
    let ganhos = 0;
    let perdidos = 0;
    for (const lead of leadsDoMes) {
      const stage = lead.stageId !== null ? stageMap.get(lead.stageId) : undefined;
      if (stage?.kind === 'won') ganhos++;
      else if (stage?.kind === 'lost') perdidos++;
      else {
        // Só as etapas "em andamento" (nem ganho nem perdido) — Ganho/Perdido já
        // têm contador próprio, não precisam aparecer de novo aqui.
        const label = stage?.label ?? '(etapa removida)';
        porEtapa.set(label, (porEtapa.get(label) ?? 0) + 1);
      }
      if (lead.formConversionUploadedAt) qualificados++;
      if (stage?.kind === 'lost' && lead.lossReasonId) {
        const reason = reasonMap.get(lead.lossReasonId);
        const label2 = reason?.label ?? '(motivo removido)';
        porMotivoPerda.set(label2, (porMotivoPerda.get(label2) ?? 0) + 1);
      }
    }

    // Fechamento do mês: diferente do bloco acima (que olha quem CHEGOU no mês),
    // aqui é quem MUDOU pra Ganho/Perdido dentro do mês, não importa quando chegou —
    // é o "resultado do mês" que bate com o que fechou de fato.
    let ganhosFechadosNoMes = 0;
    let perdidosFechadosNoMes = 0;
    let receitaFechadosNoMes = 0;
    const porMotivoPerdaFechadosNoMes = new Map<string, number>();
    for (const lead of leadsFechadosNoMes) {
      const stage = lead.stageId !== null ? stageMap.get(lead.stageId) : undefined;
      if (stage?.kind === 'won') {
        ganhosFechadosNoMes++;
        receitaFechadosNoMes += lead.conversionValue ?? 0;
      }
      if (stage?.kind === 'lost') {
        perdidosFechadosNoMes++;
        const reason = lead.lossReasonId ? reasonMap.get(lead.lossReasonId) : undefined;
        const label = reason?.label ?? '(motivo removido)';
        porMotivoPerdaFechadosNoMes.set(label, (porMotivoPerdaFechadosNoMes.get(label) ?? 0) + 1);
      }
    }
    const wonStageIds = stages.filter((s) => s.kind === 'won').map((s) => s.id);
    const totalAcumuladoGanhos = await this.leads.countByStageIds(customerId, wonStageIds);

    const funil = {
      total_leads: leadsDoMes.length,
      leads_qualificados: qualificados,
      ganhos,
      perdidos,
      em_andamento_por_etapa: Array.from(porEtapa.entries()).map(([etapa, quantidade]) => ({ etapa, quantidade })),
      motivos_de_perda: Array.from(porMotivoPerda.entries()).map(([motivo, quantidade]) => ({ motivo, quantidade })),
      fechamento_mes: {
        ganhos: ganhosFechadosNoMes,
        perdidos: perdidosFechadosNoMes,
        receita: Number(receitaFechadosNoMes.toFixed(2)),
        totalAcumulado: totalAcumuladoGanhos,
        motivos_de_perda: Array.from(porMotivoPerdaFechadosNoMes.entries()).map(([motivo, quantidade]) => ({ motivo, quantidade })),
      },
    };

    const campanhas = [
      ...googleCampaigns.map((c) => ({ plataforma: 'Google Ads', nome: c.campaignName ?? c.campaignId })),
      ...metaCampaigns.map((c) => ({ plataforma: 'Meta Ads', nome: c.campaignName ?? c.campaignId })),
    ];

    const mesAtualResumo = { mes: month, ...totais, fechamentos: funil.fechamento_mes.ganhos };
    const meses = [mesM2, mesM1, mesAtualResumo];
    const comparativo = { meses, analise: this.buildComparativoInsights(meses) };

    return { mes: month, campanhas, semanas, totais, funil, demograficos, comparativo, recomendacoes: [] as string[], feeGestao: 0 };
  }

  /** Início/fim de um mês 'YYYY-MM' + a string de dateRange que as APIs de ads entendem. */
  private monthDateRange(month: string): { monthStart: string; monthEnd: string; dateRange: string } {
    const monthStart = `${month}-01`;
    const end = new Date(`${month}-01T00:00:00.000Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(end.getUTCDate() - 1);
    const monthEnd = end.toISOString().slice(0, 10);
    return { monthStart, monthEnd, dateRange: `CUSTOM:${monthStart}:${monthEnd}` };
  }

  /** 'YYYY-MM' deslocado em n meses (n negativo = passado). */
  private shiftMonth(month: string, n: number): string {
    const d = new Date(`${month}-01T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 7);
  }

  /** Só os totais do mês (sem semanas) — usado pros 2 meses anteriores no comparativo,
   * que não precisam do detalhe semanal, só do total pra comparar. */
  private async fetchMonthSummary(
    customerId: string,
    month: string,
    googleCampaigns: { campaignId: string }[],
    metaCampaigns: { campaignId: string; accountId?: string | null }[],
  ) {
    const { dateRange } = this.monthDateRange(month);
    const [googleDaily, metaDaily, leadsFechados, stages] = await Promise.all([
      googleCampaigns.length
        ? this.googleAds.getCampaignMetricsDaily(customerId, googleCampaigns.map((c) => c.campaignId), dateRange)
        : Promise.resolve([]),
      this.fetchMetaDaily(customerId, metaCampaigns, dateRange),
      this.leads.findChangedInMonth(customerId, month),
      this.crmStages.findAll(customerId),
    ]);
    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const fechamentos = leadsFechados.filter((l) => {
      const stage = l.stageId !== null ? stageMap.get(l.stageId) : undefined;
      return stage?.kind === 'won';
    }).length;
    const totais = this.sumRows([...googleDaily, ...metaDaily]);
    return { mes: month, ...totais, fechamentos };
  }

  /** Comparações calculadas em cima dos 3 meses — nunca texto inventado. */
  private buildComparativoInsights(meses: { mes: string; custo: number; conversoes: number; fechamentos: number }[]): string {
    const comGasto = meses.filter((m) => m.custo > 0);
    if (comGasto.length < 2) return '';

    const atual = meses[meses.length - 1];
    const anterior = meses[meses.length - 2];
    const linhas: string[] = [];

    if (anterior.custo > 0) {
      const deltaCusto = ((atual.custo - anterior.custo) / anterior.custo) * 100;
      linhas.push(`Investimento ${deltaCusto >= 0 ? 'subiu' : 'caiu'} ${Math.abs(deltaCusto).toFixed(0)}% em relação ao mês anterior.`);
    }
    if (anterior.conversoes > 0) {
      const deltaConv = ((atual.conversoes - anterior.conversoes) / anterior.conversoes) * 100;
      linhas.push(`Conversões ${deltaConv >= 0 ? 'subiram' : 'caíram'} ${Math.abs(deltaConv).toFixed(0)}% em relação ao mês anterior.`);
    } else if (atual.conversoes > 0) {
      linhas.push('O mês anterior não teve conversões registradas.');
    }
    if (atual.fechamentos !== anterior.fechamentos) {
      linhas.push(`Fechamentos: ${atual.fechamentos} esse mês vs ${anterior.fechamentos} no mês anterior.`);
    }

    return linhas.join(' ');
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

  /**
   * Uma frase por semana, calculada em cima do dado real dela — nunca
   * inventada. Compara com as outras semanas do mesmo relatório (mais cara,
   * mais barata, melhor custo por conversão) só quando há mais de uma semana
   * com gasto pra comparar.
   */
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

  // ─── CRUD dos relatórios salvos ─────────────────────────────────────────

  async create(customerId: string, month: string, data: any, observations: string | null): Promise<MonthlyReport> {
    const campaignNames = data.campanhas.map((c: any) => `${c.plataforma}: ${c.nome}`).join(', ') || 'Nenhuma campanha';
    const report = this.repo.create({
      customerId, month,
      campaignNames,
      summaryData: JSON.stringify(data),
      autoInsights: null,
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
