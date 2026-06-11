import { Injectable, OnModuleInit } from '@nestjs/common';
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

  private getCustomer(customerId: string) {
    const cleanId = customerId.replace(/-/g, '');
    return this.client.Customer({
      customer_id: cleanId,
      refresh_token: this.config.getOrThrow('GOOGLE_REFRESH_TOKEN'),
      login_customer_id: this.config.getOrThrow('GOOGLE_MCC_CUSTOMER_ID'),
    });
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
      WHERE segments.date DURING ${dateRange}
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
        AND segments.date DURING ${dateRange}
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
      WHERE campaign.id = ${campaignId}
        AND segments.date DURING ${dateRange}
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
      WHERE campaign.id = ${campaignId}
        AND ad_group.status != 'REMOVED'
        AND segments.date DURING ${dateRange}
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

  async getKeywordPerformance(
    customerId: string,
    campaignId?: string,
    dateRange = 'LAST_7_DAYS',
  ) {
    const customer = this.getCustomer(customerId);
    const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : '';

    const rows = await customer.query(`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        campaign.name,
        ad_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        ad_group_criterion.quality_info.quality_score
      FROM keyword_view
      WHERE ad_group_criterion.status != 'REMOVED'
        ${campaignFilter}
        AND segments.date DURING ${dateRange}
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `);

    return rows.map((r) => ({
      palavra_chave: r.ad_group_criterion.keyword.text,
      tipo_correspondencia: r.ad_group_criterion.keyword.match_type,
      campanha: r.campaign.name,
      grupo_anuncio: r.ad_group.name,
      status: r.ad_group_criterion.status,
      impressoes: Number(r.metrics.impressions),
      cliques: Number(r.metrics.clicks),
      custo: `R$ ${(Number(r.metrics.cost_micros) / 1_000_000).toFixed(2)}`,
      ctr: `${(Number(r.metrics.ctr) * 100).toFixed(2)}%`,
      cpc_medio: `R$ ${(Number(r.metrics.average_cpc) / 1_000_000).toFixed(2)}`,
      conversoes: Number(r.metrics.conversions),
      indice_qualidade: r.ad_group_criterion.quality_info?.quality_score ?? 'N/A',
    }));
  }
}
