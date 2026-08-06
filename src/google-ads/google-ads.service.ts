import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAdsApi } from 'google-ads-api';

@Injectable()
export class GoogleAdsService implements OnModuleInit {
  private client: GoogleAdsApi;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new GoogleAdsApi({
      client_id: this.config.getOrThrow('GOOGLE_CLIENT_ID'),
      client_secret: this.config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      developer_token: this.config.getOrThrow('GOOGLE_DEVELOPER_TOKEN'),
    });
  }

  /**
   * Garante que um ID contém apenas dígitos antes de ser interpolado em GAQL
   * ou em resource names. Bloqueia injeção (ex: "0 OR 1=1").
   */
  private numId(value: string, field = 'id'): string {
    const clean = String(value ?? '').replace(/-/g, '');
    if (!/^\d+$/.test(clean)) {
      throw new BadRequestException(`Parâmetro ${field} inválido`);
    }
    return clean;
  }

  /** Valida datas no formato YYYY-MM-DD antes de interpolar no filtro GAQL */
  private safeDate(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Data inválida');
    }
    return value;
  }

  private getCustomer(customerId: string) {
    const cleanId = this.numId(customerId, 'customerId');
    return this.client.Customer({
      customer_id: cleanId,
      refresh_token: this.config.getOrThrow('GOOGLE_REFRESH_TOKEN'),
      login_customer_id: this.config.getOrThrow('GOOGLE_MCC_CUSTOMER_ID'),
    });
  }

  private decodeMatchType(v: unknown): string {
    // google-ads-api v23 enum: 2=EXACT, 3=PHRASE, 4=BROAD
    if (typeof v === 'string') {
      const u = v.toUpperCase();
      if (u === 'BROAD') return 'BROAD';
      if (u === 'PHRASE') return 'PHRASE';
      if (u === 'EXACT') return 'EXACT';
    }
    const n = Number(v);
    if (n === 4) return 'BROAD';
    if (n === 3) return 'PHRASE';
    if (n === 2) return 'EXACT';
    return 'BROAD';
  }

  private decodeApproval(v: unknown): string {
    const map: Record<number, string> = { 2: 'APPROVED', 3: 'APPROVED_LIMITED', 4: 'DISAPPROVED', 5: 'UNDER_REVIEW' };
    return map[Number(v)] ?? 'UNKNOWN';
  }

  private decodeServing(v: unknown): string {
    const map: Record<number, string> = { 2: 'ELIGIBLE', 3: 'RARELY_SERVED' };
    return map[Number(v)] ?? 'UNKNOWN';
  }

  private decodeQuality(v: unknown): string | null {
    if (v == null) return null;
    const map: Record<number, string> = { 2: 'ABOVE_AVERAGE', 3: 'AVERAGE', 4: 'BELOW_AVERAGE' };
    return map[Number(v)] ?? null;
  }

  private buildDateFilter(dateRange: string): string {
    if (dateRange.startsWith('CUSTOM:')) {
      const parts = dateRange.split(':');
      return `BETWEEN '${this.safeDate(parts[1])}' AND '${this.safeDate(parts[2])}'`;
    }
    // Períodos predefinidos do Google Ads: letras, dígitos e underscore
    // (ex: LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH). Bloqueia qualquer injeção.
    if (!/^[A-Z0-9_]+$/.test(dateRange)) {
      throw new BadRequestException('Período inválido');
    }
    return `DURING ${dateRange}`;
  }

  async listManagedAccounts() {
    const mccId = this.config.getOrThrow('GOOGLE_MCC_CUSTOMER_ID');
    const customer = this.client.Customer({
      customer_id: mccId,
      refresh_token: this.config.getOrThrow('GOOGLE_REFRESH_TOKEN'),
    });

    const accounts = await customer.query(`
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.status
      FROM customer_client
      WHERE customer_client.manager = false
        AND customer_client.status = 'ENABLED'
    `);

    return accounts.map((a) => ({
      id: String(a.customer_client.id),
      name: a.customer_client.descriptive_name,
      currency: a.customer_client.currency_code,
    }));
  }

  async getAccountOverview(customerId: string, dateRange = 'LAST_7_DAYS') {
    const customer = this.getCustomer(customerId);

    const rows = await customer.query(`
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM customer
      WHERE segments.date ${this.buildDateFilter(dateRange)}
    `);

    if (!rows.length) return { periodo: dateRange, mensagem: 'Sem dados no período.' };

    const m = rows[0].metrics;
    const clicks = Number(m.clicks);
    const conversions = Number(m.conversions);
    return {
      periodo: dateRange,
      impressoes: Number(m.impressions),
      cliques: clicks,
      custo: `R$ ${(Number(m.cost_micros) / 1_000_000).toFixed(2)}`,
      ctr: `${((Number(m.ctr) || 0) * 100).toFixed(2)}%`,
      cpc_medio: `R$ ${((Number(m.average_cpc) || 0) / 1_000_000).toFixed(2)}`,
      conversoes: conversions,
      custo_por_conversao:
        conversions > 0
          ? `R$ ${(Number(m.cost_per_conversion) / 1_000_000).toFixed(2)}`
          : 'Sem conversões',
      taxa_conversao:
        clicks > 0 ? `${((conversions / clicks) * 100).toFixed(2)}%` : '0.00%',
    };
  }

  async listCampaigns(customerId: string, dateRange = 'LAST_7_DAYS') {
    const customer = this.getCustomer(customerId);

    const rows = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date ${this.buildDateFilter(dateRange)}
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((r) => {
      const clicks = Number(r.metrics.clicks);
      const conversions = Number(r.metrics.conversions);
      return {
        id: String(r.campaign.id),
        nome: r.campaign.name,
        status: r.campaign.status,
        estrategia_lance: r.campaign.bidding_strategy_type,
        orcamento_diario: r.campaign_budget?.amount_micros
          ? `R$ ${(Number(r.campaign_budget.amount_micros) / 1_000_000).toFixed(2)}`
          : 'N/A',
        impressoes: Number(r.metrics.impressions),
        cliques: clicks,
        custo: `R$ ${(Number(r.metrics.cost_micros) / 1_000_000).toFixed(2)}`,
        ctr: `${((Number(r.metrics.ctr) || 0) * 100).toFixed(2)}%`,
        cpc_medio: `R$ ${((Number(r.metrics.average_cpc) || 0) / 1_000_000).toFixed(2)}`,
        conversoes: conversions,
        custo_por_conversao:
          conversions > 0
            ? `R$ ${(Number(r.metrics.cost_per_conversion) / 1_000_000).toFixed(2)}`
            : 'Sem conversões',
        taxa_conversao:
          clicks > 0 ? `${((conversions / clicks) * 100).toFixed(2)}%` : '0.00%',
      };
    });
  }

  async getCampaignDetails(
    customerId: string,
    campaignId: string,
    dateRange = 'LAST_7_DAYS',
  ) {
    const customer = this.getCustomer(customerId);

    const [campaign] = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
        AND segments.date ${this.buildDateFilter(dateRange)}
    `);

    if (!campaign) return { erro: `Campanha ${campaignId} não encontrada.` };

    const m = campaign.metrics;
    return {
      id: String(campaign.campaign.id),
      nome: campaign.campaign.name,
      status: campaign.campaign.status,
      estrategia_lance: campaign.campaign.bidding_strategy_type,
      orcamento_diario: campaign.campaign_budget?.amount_micros
        ? `R$ ${(Number(campaign.campaign_budget.amount_micros) / 1_000_000).toFixed(2)}`
        : 'N/A',
      periodo: dateRange,
      impressoes: Number(m.impressions),
      cliques: Number(m.clicks),
      custo: `R$ ${(Number(m.cost_micros) / 1_000_000).toFixed(2)}`,
      ctr: `${((Number(m.ctr) || 0) * 100).toFixed(2)}%`,
      cpc_medio: `R$ ${((Number(m.average_cpc) || 0) / 1_000_000).toFixed(2)}`,
      conversoes: Number(m.conversions),
      custo_por_conversao:
        Number(m.conversions) > 0
          ? `R$ ${(Number(m.cost_per_conversion) / 1_000_000).toFixed(2)}`
          : 'Sem conversões',
      taxa_conversao:
        Number(m.clicks) > 0
          ? `${((Number(m.conversions) / Number(m.clicks)) * 100).toFixed(2)}%`
          : '0.00%',
      parcela_impressoes_busca: m.search_impression_share
        ? `${(Number(m.search_impression_share) * 100).toFixed(1)}%`
        : 'N/A',
      impressoes_perdidas_orcamento: m.search_budget_lost_impression_share
        ? `${(Number(m.search_budget_lost_impression_share) * 100).toFixed(1)}%`
        : 'N/A',
      impressoes_perdidas_ranking: m.search_rank_lost_impression_share
        ? `${(Number(m.search_rank_lost_impression_share) * 100).toFixed(1)}%`
        : 'N/A',
    };
  }

  async listAdGroups(
    customerId: string,
    campaignId: string,
    dateRange = 'LAST_7_DAYS',
  ) {
    const customer = this.getCustomer(customerId);

    const rows = await customer.query(`
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.conversions
      FROM ad_group
      WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
        AND ad_group.status != 'REMOVED'
        AND segments.date ${this.buildDateFilter(dateRange)}
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((r) => ({
      id: String(r.ad_group.id),
      nome: r.ad_group.name,
      status: r.ad_group.status,
      tipo: r.ad_group.type,
      impressoes: Number(r.metrics.impressions),
      cliques: Number(r.metrics.clicks),
      custo: `R$ ${(Number(r.metrics.cost_micros) / 1_000_000).toFixed(2)}`,
      ctr: `${(Number(r.metrics.ctr) * 100).toFixed(2)}%`,
      conversoes: Number(r.metrics.conversions),
    }));
  }

  /**
   * Anúncios (criativos) de uma campanha — título/descrições, status, URL final e métricas.
   * status/tipo vêm como código numérico bruto da API (mesmo padrão de listAdGroups/getCampaigns
   * já existente) — a decodificação pra rótulo em português acontece no frontend.
   */
  async listAds(customerId: string, campaignId: string, dateRange = 'LAST_7_DAYS') {
    const customer = this.getCustomer(customerId);

    const rows = await customer.query(`
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group.id,
        ad_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.conversions
      FROM ad_group_ad
      WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
        AND ad_group_ad.status != 'REMOVED'
        AND segments.date ${this.buildDateFilter(dateRange)}
      ORDER BY metrics.cost_micros DESC
    `);

    return rows.map((r) => {
      const ad = r.ad_group_ad?.ad as any;
      return {
        id: String(ad?.id ?? ''),
        tipo: ad?.type,
        status: r.ad_group_ad?.status,
        grupo_anuncio: r.ad_group?.name ?? '',
        url_final: ad?.final_urls?.[0] ?? null,
        titulos: (ad?.responsive_search_ad?.headlines ?? []).map((h: any) => h.text),
        descricoes: (ad?.responsive_search_ad?.descriptions ?? []).map((d: any) => d.text),
        impressoes: Number(r.metrics.impressions),
        cliques: Number(r.metrics.clicks),
        custo: `R$ ${(Number(r.metrics.cost_micros) / 1_000_000).toFixed(2)}`,
        ctr: `${(Number(r.metrics.ctr) * 100).toFixed(2)}%`,
        conversoes: Number(r.metrics.conversions),
      };
    });
  }

  async getKeywordPerformance(
    customerId: string,
    campaignId?: string,
    dateRange = 'LAST_7_DAYS',
  ) {
    const customer = this.getCustomer(customerId);
    const campaignFilter = campaignId ? `AND campaign.id = ${this.numId(campaignId, 'campaignId')}` : '';

    // Busca todas as palavras-chave (sem filtro de data para não perder kws sem atividade)
    const [kwRows, metricRows] = await Promise.all([
      customer.query(`
        SELECT
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          ad_group_criterion.approval_status,
          ad_group_criterion.system_serving_status,
          ad_group_criterion.quality_info.quality_score,
          ad_group_criterion.quality_info.search_predicted_ctr,
          ad_group_criterion.quality_info.creative_quality_score,
          ad_group_criterion.quality_info.post_click_quality_score,
          campaign.id,
          campaign.name,
          ad_group.name
        FROM ad_group_criterion
        WHERE ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.negative = false
          AND ad_group_criterion.status != 'REMOVED'
          ${campaignFilter}
        ORDER BY ad_group_criterion.keyword.text ASC
        LIMIT 200
      `),
      customer.query(`
        SELECT
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          campaign.id,
          ad_group.name,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.ctr,
          metrics.average_cpc,
          metrics.conversions
        FROM keyword_view
        WHERE ad_group_criterion.status != 'REMOVED'
          ${campaignFilter}
          AND segments.date ${this.buildDateFilter(dateRange)}
        LIMIT 200
      `),
    ]);

    // Cria mapa de métricas por "campanha|grupo|keyword|tipo de correspondência" —
    // precisa incluir o match_type porque duas keywords podem ter o MESMO texto
    // com correspondências diferentes (ex: "termo" em Ampla e em Frase); sem isso
    // uma sobrescrevia a métrica da outra e a conversão real sumia da tela.
    const metricsMap = new Map<string, (typeof metricRows)[0]>();
    for (const r of metricRows) {
      const key = `${r.campaign?.id}|${r.ad_group?.name}|${r.ad_group_criterion?.keyword?.text}|${r.ad_group_criterion?.keyword?.match_type}`;
      metricsMap.set(key, r);
    }

    return kwRows.map((r) => {
      const key = `${r.campaign?.id}|${r.ad_group?.name}|${r.ad_group_criterion?.keyword?.text}|${r.ad_group_criterion?.keyword?.match_type}`;
      const m = metricsMap.get(key);
      return {
        palavra_chave: r.ad_group_criterion.keyword.text,
        tipo_correspondencia: this.decodeMatchType(r.ad_group_criterion.keyword?.match_type),
        campanha: r.campaign.name,
        grupo_anuncio: r.ad_group.name,
        status: r.ad_group_criterion.status,
        impressoes: m ? Number(m.metrics.impressions) : 0,
        cliques: m ? Number(m.metrics.clicks) : 0,
        custo: `R$ ${m ? (Number(m.metrics.cost_micros) / 1_000_000).toFixed(2) : '0.00'}`,
        ctr: m ? `${(isNaN(Number(m.metrics.ctr)) ? 0 : Number(m.metrics.ctr) * 100).toFixed(2)}%` : '0.00%',
        cpc_medio: m ? `R$ ${(isNaN(Number(m.metrics.average_cpc)) ? 0 : Number(m.metrics.average_cpc) / 1_000_000).toFixed(2)}` : 'R$ 0.00',
        conversoes: m ? Number(m.metrics.conversions) : 0,
        indice_qualidade: r.ad_group_criterion.quality_info?.quality_score ?? 'N/A',
        status_aprovacao: this.decodeApproval(r.ad_group_criterion.approval_status),
        status_veiculacao: this.decodeServing(r.ad_group_criterion.system_serving_status),
        ctr_previsto: this.decodeQuality(r.ad_group_criterion.quality_info?.search_predicted_ctr),
        relevancia_anuncio: this.decodeQuality(r.ad_group_criterion.quality_info?.creative_quality_score),
        qualidade_pagina: this.decodeQuality(r.ad_group_criterion.quality_info?.post_click_quality_score),
      };
    });
  }

  async getNegativeKeywords(customerId: string, campaignId: string) {
    const customer = this.getCustomer(customerId);

    const [campNegs, groupNegs] = await Promise.all([
      customer.query(`
        SELECT
          campaign_criterion.resource_name,
          campaign_criterion.keyword.text,
          campaign_criterion.keyword.match_type
        FROM campaign_criterion
        WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
          AND campaign_criterion.negative = true
          AND campaign_criterion.type = 'KEYWORD'
      `),
      customer.query(`
        SELECT
          ad_group_criterion.resource_name,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group.name
        FROM ad_group_criterion
        WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
          AND ad_group_criterion.negative = true
          AND ad_group_criterion.type = 'KEYWORD'
      `),
    ]);

    return {
      nivel_campanha: campNegs.map((r) => ({
        resource_name: r.campaign_criterion.resource_name ?? '',
        palavra: r.campaign_criterion.keyword?.text ?? '',
        tipo: this.decodeMatchType(r.campaign_criterion.keyword?.match_type),
      })),
      nivel_grupo: groupNegs.map((r) => ({
        resource_name: r.ad_group_criterion.resource_name ?? '',
        palavra: r.ad_group_criterion.keyword?.text ?? '',
        tipo: this.decodeMatchType(r.ad_group_criterion.keyword?.match_type),
        grupo: r.ad_group?.name ?? '',
      })),
    };
  }

  async removeNegativeKeywords(
    customerId: string,
    resourceNames: { nivel: 'campanha' | 'grupo'; resource_name: string }[],
  ) {
    const customer = this.getCustomer(customerId);
    const cleanCustomer = this.numId(customerId, 'customerId');

    // Recusa resource_names que não pertençam a esta conta (defesa cross-tenant)
    const belongsToCustomer = (rn: string) => rn.startsWith(`customers/${cleanCustomer}/`);
    for (const r of resourceNames) {
      if (!belongsToCustomer(r.resource_name)) {
        throw new BadRequestException('resource_name não pertence a esta conta');
      }
    }

    const campNames = resourceNames.filter(r => r.nivel === 'campanha').map(r => r.resource_name);
    const groupNames = resourceNames.filter(r => r.nivel === 'grupo').map(r => r.resource_name);

    await Promise.all([
      campNames.length ? customer.campaignCriteria.remove(campNames) : Promise.resolve(),
      groupNames.length ? customer.adGroupCriteria.remove(groupNames) : Promise.resolve(),
    ]);

    return { removidas: resourceNames.length };
  }

  async addNegativeKeyword(
    customerId: string,
    campaignId: string,
    keyword: string,
    matchType: 'EXACT' | 'PHRASE' | 'BROAD',
    nivel: 'campanha' | 'grupo',
    adGroupId?: string,
  ) {
    const customer = this.getCustomer(customerId);
    const cleanCustomer = this.numId(customerId, 'customerId');

    if (nivel === 'campanha') {
      await customer.campaignCriteria.create([{
        campaign: `customers/${cleanCustomer}/campaigns/${this.numId(campaignId, 'campaignId')}`,
        negative: true,
        keyword: { text: keyword, match_type: matchType },
      } as any]);
    } else {
      if (!adGroupId) throw new Error('adGroupId obrigatório para nível grupo');
      await customer.adGroupCriteria.create([{
        ad_group: `customers/${cleanCustomer}/adGroups/${this.numId(adGroupId, 'adGroupId')}`,
        negative: true,
        keyword: { text: keyword, match_type: matchType },
      } as any]);
    }

    return { adicionada: keyword, nivel, matchType };
  }

  async addPositiveKeyword(
    customerId: string,
    adGroupId: string,
    keyword: string,
    matchType: 'EXACT' | 'PHRASE' | 'BROAD',
  ) {
    const customer = this.getCustomer(customerId);
    const cleanCustomer = this.numId(customerId, 'customerId');
    await customer.adGroupCriteria.create([{
      ad_group: `customers/${cleanCustomer}/adGroups/${this.numId(adGroupId, 'adGroupId')}`,
      keyword: { text: keyword, match_type: matchType },
    } as any]);
    return { adicionada: keyword, matchType, adGroupId };
  }

  async getDemographics(
    customerId: string,
    campaignId: string,
    dateRange = 'LAST_30_DAYS',
  ) {
    const customer = this.getCustomer(customerId);

    const [ageRows, genderRows, incomeRows] = await Promise.all([
      customer.query(`
        SELECT
          ad_group_criterion.age_range.type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM age_range_view
        WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
          AND segments.date ${this.buildDateFilter(dateRange)}
        ORDER BY metrics.impressions DESC
      `),
      customer.query(`
        SELECT
          ad_group_criterion.gender.type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM gender_view
        WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
          AND segments.date ${this.buildDateFilter(dateRange)}
      `),
      customer.query(`
        SELECT
          ad_group_criterion.income_range.type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM income_range_view
        WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
          AND segments.date ${this.buildDateFilter(dateRange)}
      `),
    ]);

    // API v23 returns numeric enum values — map to display labels
    const AGE: Record<number, string> = {
      503001: '18–24', 503002: '25–34', 503003: '35–44',
      503004: '45–54', 503005: '55–64', 503006: '65+', 503999: 'Desconhecido',
    };
    const GENDER: Record<number, string> = {
      10: 'Masculino', 11: 'Feminino', 20: 'Desconhecido',
    };
    const INCOME: Record<number, string> = {
      510000: 'Desconhecido', 510001: 'Abaixo de 50%', 510002: '50–60%', 510003: '60–70%',
      510004: '70–80%', 510005: '80–90%', 510006: 'Acima de 90%', 510999: 'Desconhecido',
    };

    const aggregate = (
      rows: any[],
      keyFn: (r: any) => number,
      labelMap: Record<number, string>,
    ) => {
      const map = new Map<number, any>();
      for (const r of rows) {
        const key = keyFn(r);
        if (!map.has(key)) {
          map.set(key, {
            label: labelMap[key] ?? `Tipo ${key}`,
            impressoes: 0, cliques: 0, custo: 0, conversoes: 0,
          });
        }
        const d = map.get(key);
        d.impressoes += Number(r.metrics.impressions);
        d.cliques += Number(r.metrics.clicks);
        d.custo += Number(r.metrics.cost_micros) / 1_000_000;
        d.conversoes += Number(r.metrics.conversions);
      }
      return Array.from(map.values())
        .filter((d) => d.impressoes > 0)
        .sort((a, b) => b.impressoes - a.impressoes)
        .map((d) => ({ ...d, custo: d.custo.toFixed(2) }));
    };

    return {
      idade: aggregate(ageRows, (r) => Number(r.ad_group_criterion.age_range?.type ?? 0), AGE),
      genero: aggregate(genderRows, (r) => Number(r.ad_group_criterion.gender?.type ?? 0), GENDER),
      renda: aggregate(incomeRows, (r) => Number(r.ad_group_criterion.income_range?.type ?? 0), INCOME),
    };
  }

  async getDayOfWeek(
    customerId: string,
    campaignId: string,
    dateRange = 'LAST_30_DAYS',
  ) {
    const customer = this.getCustomer(customerId);

    // Query by segments.date and compute day_of_week in code for reliability
    const rows = await customer.query(`
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
        AND segments.date ${this.buildDateFilter(dateRange)}
      ORDER BY segments.date
    `);

    // 0=Sun,1=Mon,...,6=Sat (JS getDay()) → map to order Mon→Sun
    const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    // Display order: Mon(1)→Sun(0)
    const ORDER = [1, 2, 3, 4, 5, 6, 0];

    const byDay: Record<number, any> = {};
    for (const r of rows) {
      const date = new Date(`${r.segments.date}T12:00:00Z`);
      const dayIndex = date.getUTCDay(); // 0=Sun ... 6=Sat
      if (!byDay[dayIndex]) byDay[dayIndex] = { impressoes: 0, cliques: 0, custo: 0, conversoes: 0 };
      byDay[dayIndex].impressoes += Number(r.metrics.impressions);
      byDay[dayIndex].cliques += Number(r.metrics.clicks);
      byDay[dayIndex].custo += Number(r.metrics.cost_micros) / 1_000_000;
      byDay[dayIndex].conversoes += Number(r.metrics.conversions);
    }

    return ORDER.map((idx) => ({
      dia: DAY_LABELS[idx],
      impressoes: byDay[idx]?.impressoes ?? 0,
      cliques: byDay[idx]?.cliques ?? 0,
      custo: `R$ ${(byDay[idx]?.custo ?? 0).toFixed(2)}`,
      conversoes: byDay[idx]?.conversoes ?? 0,
    }));
  }

  async getDevices(
    customerId: string,
    campaignId: string,
    dateRange = 'LAST_30_DAYS',
  ) {
    const customer = this.getCustomer(customerId);

    const rows = await customer.query(`
      SELECT
        segments.device,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${this.numId(campaignId, 'campaignId')}
        AND segments.date ${this.buildDateFilter(dateRange)}
    `);

    // API v23 returns numeric enum: 2=MOBILE, 3=TABLET, 4=DESKTOP, 5=OTHER, 6=CONNECTED_TV
    const DEV: Record<number, string> = {
      2: 'Mobile', 3: 'Tablet', 4: 'Desktop', 5: 'Outros', 6: 'TV Conectada',
    };

    const byDevice: Record<number, any> = {};
    for (const r of rows) {
      const d = Number(r.segments.device);
      if (!byDevice[d]) byDevice[d] = { label: DEV[d] ?? `Dispositivo ${d}`, impressoes: 0, cliques: 0, custo: 0, conversoes: 0 };
      byDevice[d].impressoes += Number(r.metrics.impressions);
      byDevice[d].cliques += Number(r.metrics.clicks);
      byDevice[d].custo += Number(r.metrics.cost_micros) / 1_000_000;
      byDevice[d].conversoes += Number(r.metrics.conversions);
    }

    return Object.values(byDevice)
      .map((d) => ({
        dispositivo: d.label,
        impressoes: d.impressoes,
        cliques: d.cliques,
        custo: `R$ ${d.custo.toFixed(2)}`,
        conversoes: d.conversoes,
        ctr: d.impressoes > 0 ? `${((d.cliques / d.impressoes) * 100).toFixed(2)}%` : '0.00%',
      }))
      .sort((a, b) => b.impressoes - a.impressoes);
  }

  async uploadOfflineConversion(
    customerId: string,
    gclid: string,
    conversionActionId: string,
    convertedAt: Date,
    value: number,
  ): Promise<{ success: boolean; detail?: string }> {
    const cleanId = this.numId(customerId, 'customerId');

    // Obter access token via refresh token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     this.config.getOrThrow('GOOGLE_CLIENT_ID'),
        client_secret: this.config.getOrThrow('GOOGLE_CLIENT_SECRET'),
        refresh_token: this.config.getOrThrow('GOOGLE_REFRESH_TOKEN'),
        grant_type:    'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json() as any;

    // Formato exigido: "yyyy-MM-dd HH:mm:ss+00:00"
    const dt = convertedAt
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '+00:00');

    const body = {
      conversions: [{
        gclid,
        conversionAction: `customers/${cleanId}/conversionActions/${conversionActionId}`,
        conversionDateTime: dt,
        conversionValue: value,
        currencyCode: 'BRL',
      }],
      partialFailure: true,
    };

    const res = await fetch(
      `https://googleads.googleapis.com/v19/customers/${cleanId}:uploadClickConversions`,
      {
        method: 'POST',
        headers: {
          Authorization:       `Bearer ${access_token}`,
          'developer-token':   this.config.getOrThrow('GOOGLE_DEVELOPER_TOKEN'),
          'login-customer-id': this.config.getOrThrow('GOOGLE_MCC_CUSTOMER_ID'),
          'Content-Type':      'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const result = await res.json() as any;
    // Loga só o suficiente pra depurar sem gravar gclid/valor/payload bruto nos logs.
    if (!res.ok) {
      console.error(`[uploadConversion] Falha na chamada à API do Google Ads (HTTP ${res.status})`);
      return { success: false, detail: JSON.stringify(result) };
    }
    if (result.partialFailureError) {
      console.warn('[uploadConversion] Falha parcial reportada pela API do Google Ads');
      return { success: false, detail: JSON.stringify(result.partialFailureError) };
    }
    return { success: true };
  }
}
