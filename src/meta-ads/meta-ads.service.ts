import { Injectable } from '@nestjs/common';

/**
 * Diferente do Google Ads (uma MCC central acessa todos os clientes com um só
 * refresh token), cada cliente tem seu próprio Business Manager no Meta — não
 * dá pra centralizar. Por isso nenhum método aqui usa um token fixo: o token
 * do cliente certo é resolvido por quem chama (o controller, via
 * WebhookConfigService) e passado em toda chamada.
 */
@Injectable()
export class MetaAdsService {
  private readonly base = 'https://graph.facebook.com/v20.0';

  // ─── HTTP helper ──────────────────────────────────────────────────────────

  private async get<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    url.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString());
    const data = await res.json() as any;
    if (data.error) throw new Error(`Meta API: ${data.error.message}`);
    return data as T;
  }

  // ─── Date params helper ───────────────────────────────────────────────────

  private dateParams(dateRange: string): Record<string, string> {
    if (dateRange.startsWith('CUSTOM:')) {
      const [, since, until] = dateRange.split(':');
      return { time_range: JSON.stringify({ since, until }) };
    }
    const MAP: Record<string, string> = {
      LAST_7_DAYS: 'last_7d', LAST_14_DAYS: 'last_14d', LAST_30_DAYS: 'last_30d',
      THIS_MONTH: 'this_month', LAST_MONTH: 'last_month',
    };
    return { date_preset: MAP[dateRange] ?? 'last_7d' };
  }

  // ─── Action extractor ─────────────────────────────────────────────────────

  private action(actions: any[] | undefined, type: string): number {
    return Number(actions?.find(a => a.action_type === type)?.value ?? 0);
  }

  /** Mesmo que `action`, mas pra action_values (valor em R$ da conversão, não a contagem). */
  private actionValue(actionValues: any[] | undefined, type: string): number {
    return Number(actionValues?.find(a => a.action_type === type)?.value ?? 0);
  }

  /**
   * Compras: tenta `omni_purchase` primeiro (evento unificado recomendado pelo
   * Meta, cobre site+app+loja) e cai pra `purchase` (pixel legado) se não
   * tiver — depende de qual versão o pixel/CAPI do cliente está mandando.
   */
  private purchases(actions: any[] | undefined): number {
    return this.action(actions, 'omni_purchase') || this.action(actions, 'purchase');
  }
  private purchaseValue(actionValues: any[] | undefined): number {
    return this.actionValue(actionValues, 'omni_purchase') || this.actionValue(actionValues, 'purchase');
  }
  private engagements(actions: any[] | undefined): number {
    return this.action(actions, 'post_engagement');
  }
  /** `landing_page_view` é o padrão atual; `omni_landing_page_view` cobre pixels/eventos mais antigos. */
  private landingPageViews(actions: any[] | undefined): number {
    return this.action(actions, 'landing_page_view') || this.action(actions, 'omni_landing_page_view');
  }

  private allActions(actions: any[] | undefined) {
    if (!actions?.length) return [];
    const LABELS: Record<string, string> = {
      'link_click': 'Cliques no link',
      'post_reaction': 'Reações',
      'post_engagement': 'Engajamento',
      'page_engagement': 'Engajamento na página',
      'omni_landing_page_view': 'Visualizações de página',
      'onsite_conversion.total_messaging_connection': 'Conexões de mensagem',
      'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
      'onsite_conversion.messaging_first_reply': 'Primeiras respostas',
      'video_view': 'Visualizações de vídeo',
      'post': 'Compartilhamentos',
    };
    return actions
      .filter(a => LABELS[a.action_type] && Number(a.value) > 0)
      .map(a => ({ tipo: LABELS[a.action_type] ?? a.action_type, valor: Number(a.value) }));
  }

  // ─── Account ──────────────────────────────────────────────────────────────

  async listAdAccounts(token: string) {
    // "business" fica de fora de propósito: exige a permissão
    // business_management, que a maioria dos tokens de cliente (System User
    // com só ads_read) não tem — pedir esse campo quebrava a chamada inteira
    // com "Requires business_management permission" pra qualquer cliente
    // configurado só com leitura de anúncios.
    const data = await this.get<any>(token, '/me/adaccounts', {
      fields: 'id,name,account_status,currency',
      limit: '100',
    });
    return (data.data ?? []).map((a: any) => ({
      id: a.id,
      nome: a.name,
      moeda: a.currency ?? 'BRL',
      status: a.account_status,
      negocio: null,
    }));
  }

  async getAccountOverview(token: string, accountId: string, dateRange = 'LAST_7_DAYS') {
    const d = this.dateParams(dateRange);
    const data = await this.get<any>(token, `/${accountId}/insights`, {
      fields: 'impressions,clicks,spend,ctr,cpc,reach,frequency,actions',
      ...d,
    });

    if (!data.data?.length) return { periodo: dateRange, mensagem: 'Sem dados no período.' };
    const r = data.data[0];
    const spend = Number(r.spend ?? 0);
    const clicks = Number(r.clicks ?? 0);
    const impr = Number(r.impressions ?? 0);
    const mensagens = this.action(r.actions, 'onsite_conversion.total_messaging_connection');
    return {
      periodo: dateRange,
      impressoes: impr,
      cliques: clicks,
      custo: `R$ ${spend.toFixed(2)}`,
      ctr: `${Number(r.ctr ?? 0).toFixed(2)}%`,
      cpc_medio: `R$ ${Number(r.cpc ?? 0).toFixed(2)}`,
      alcance: Number(r.reach ?? 0),
      frequencia: Number(r.frequency ?? 0).toFixed(2),
      mensagens,
      conversoes: mensagens,
      custo_por_conversao: mensagens > 0 ? `R$ ${(spend / mensagens).toFixed(2)}` : 'Sem conversões',
      taxa_conversao: clicks > 0 ? `${((mensagens / clicks) * 100).toFixed(2)}%` : '0.00%',
    };
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  async listCampaigns(token: string, accountId: string, dateRange = 'LAST_7_DAYS') {
    const d = this.dateParams(dateRange);

    const [campsData, insightsData] = await Promise.all([
      this.get<any>(token, `/${accountId}/campaigns`, {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget',
        limit: '100',
      }),
      this.get<any>(token, `/${accountId}/insights`, {
        fields: 'campaign_id,impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
        level: 'campaign', limit: '200', ...d,
      }),
    ]);

    const iMap = new Map<string, any>();
    for (const ins of insightsData.data ?? []) iMap.set(ins.campaign_id, ins);

    const OBJ: Record<string, string> = {
      OUTCOME_ENGAGEMENT: 'Engajamento', OUTCOME_AWARENESS: 'Reconhecimento',
      OUTCOME_TRAFFIC: 'Tráfego', OUTCOME_LEADS: 'Leads',
      OUTCOME_SALES: 'Vendas', OUTCOME_APP_PROMOTION: 'App',
    };

    return (campsData.data ?? []).map((c: any) => {
      const ins = iMap.get(c.id);
      const spend = Number(ins?.spend ?? 0);
      const clicks = Number(ins?.clicks ?? 0);
      const objetivo = OBJ[c.objective] ?? c.objective ?? 'N/A';
      const mensagens = this.action(ins?.actions, 'onsite_conversion.total_messaging_connection');
      const compras = this.purchases(ins?.actions);
      const valorCompras = this.purchaseValue(ins?.action_values);
      const engajamentos = this.engagements(ins?.actions);

      // "Conversão principal" muda com o objetivo — pra Vendas é compra, pra
      // Engajamento é engajamento, resto (Leads/Mensagens e afins) é mensagem.
      // As métricas completas (compras/valor/roas/engajamentos) sempre vêm
      // no objeto, independente disso — isso aqui só decide o resumo padrão.
      const principal = objetivo === 'Vendas' ? compras : objetivo === 'Engajamento' ? engajamentos : mensagens;

      return {
        id: c.id,
        nome: c.name,
        status: c.status,
        objetivo,
        orcamento_diario: c.daily_budget ? `R$ ${(Number(c.daily_budget) / 100).toFixed(2)}` : null,
        orcamento_lifetime: c.lifetime_budget ? `R$ ${(Number(c.lifetime_budget) / 100).toFixed(2)}` : null,
        impressoes: Number(ins?.impressions ?? 0),
        cliques: clicks,
        custo: `R$ ${spend.toFixed(2)}`,
        ctr: `${Number(ins?.ctr ?? 0).toFixed(2)}%`,
        cpc_medio: `R$ ${Number(ins?.cpc ?? 0).toFixed(2)}`,
        cpm: `R$ ${Number(ins?.cpm ?? 0).toFixed(2)}`,
        alcance: Number(ins?.reach ?? 0),
        visualizacoes_pagina: this.landingPageViews(ins?.actions),
        mensagens,
        compras,
        valor_compras: `R$ ${valorCompras.toFixed(2)}`,
        roas: spend > 0 ? Number((valorCompras / spend).toFixed(2)) : 0,
        custo_por_compra: compras > 0 ? `R$ ${(spend / compras).toFixed(2)}` : 'Sem compras',
        engajamentos,
        custo_por_engajamento: engajamentos > 0 ? `R$ ${(spend / engajamentos).toFixed(2)}` : 'Sem engajamento',
        conversoes: principal,
        custo_por_conversao: principal > 0 ? `R$ ${(spend / principal).toFixed(2)}` : 'Sem conversões',
        taxa_conversao: clicks > 0 ? `${((principal / clicks) * 100).toFixed(2)}%` : '0.00%',
      };
    });
  }

  // ─── Ad Sets (equivalent of keywords for Meta) ────────────────────────────

  async listAdSets(token: string, accountId: string, campaignId: string, dateRange = 'LAST_7_DAYS') {
    const d = this.dateParams(dateRange);
    const filter = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]);

    const [adSetsData, insightsData] = await Promise.all([
      this.get<any>(token, `/${campaignId}/adsets`, {
        fields: 'id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal',
        limit: '100',
      }),
      this.get<any>(token, `/${accountId}/insights`, {
        fields: 'adset_id,impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values',
        level: 'adset', filtering: filter, limit: '200', ...d,
      }),
    ]);

    const iMap = new Map<string, any>();
    for (const ins of insightsData.data ?? []) iMap.set(ins.adset_id, ins);

    return (adSetsData.data ?? []).map((a: any) => {
      const ins = iMap.get(a.id);
      const t = a.targeting ?? {};
      const spend = Number(ins?.spend ?? 0);
      const mensagens = this.action(ins?.actions, 'onsite_conversion.total_messaging_connection');
      const compras = this.purchases(ins?.actions);
      const valorCompras = this.purchaseValue(ins?.action_values);
      const engajamentos = this.engagements(ins?.actions);
      const visualizacoesPagina = this.landingPageViews(ins?.actions);
      return {
        id: a.id,
        nome: a.name,
        status: a.status,
        orcamento_diario: a.daily_budget ? `R$ ${(Number(a.daily_budget) / 100).toFixed(2)}` : null,
        segmentacao: {
          idade: t.age_min && t.age_max ? `${t.age_min}–${t.age_max} anos` : null,
          generos: (t.genders ?? []).map((g: number) => g === 1 ? 'Masculino' : 'Feminino'),
          interesses: (t.flexible_spec ?? []).flatMap((s: any) => (s.interests ?? []).map((i: any) => i.name)),
          publicos_custom: (t.custom_audiences ?? []).map((a: any) => a.name),
          exclusoes: (t.excluded_custom_audiences ?? []).map((a: any) => a.name),
          localizacoes: t.geo_locations?.countries ?? t.geo_locations?.regions?.map((r: any) => r.name) ?? [],
          plataformas: t.publisher_platforms ?? [],
        },
        impressoes: Number(ins?.impressions ?? 0),
        cliques: Number(ins?.clicks ?? 0),
        custo: `R$ ${spend.toFixed(2)}`,
        ctr: `${Number(ins?.ctr ?? 0).toFixed(2)}%`,
        cpm: `R$ ${Number(ins?.cpm ?? 0).toFixed(2)}`,
        alcance: Number(ins?.reach ?? 0),
        frequencia: Number(ins?.frequency ?? 0).toFixed(2),
        visualizacoes_pagina: visualizacoesPagina,
        mensagens,
        custo_por_mensagem: mensagens > 0 ? `R$ ${(spend / mensagens).toFixed(2)}` : 'Sem conversões',
        compras,
        valor_compras: `R$ ${valorCompras.toFixed(2)}`,
        roas: spend > 0 ? Number((valorCompras / spend).toFixed(2)) : 0,
        custo_por_compra: compras > 0 ? `R$ ${(spend / compras).toFixed(2)}` : 'Sem compras',
        engajamentos,
        custo_por_engajamento: engajamentos > 0 ? `R$ ${(spend / engajamentos).toFixed(2)}` : 'Sem engajamento',
        acoes: this.allActions(ins?.actions),
      };
    });
  }

  /**
   * Anúncios de um conjunto — mesma lógica/métricas de listAdSets, um nível
   * abaixo. Traz a criativa (thumbnail, título, texto) pra dar contexto
   * visual de qual peça é qual, sem precisar abrir o Gerenciador de Anúncios.
   */
  async listAds(token: string, accountId: string, adSetId: string, dateRange = 'LAST_7_DAYS') {
    const d = this.dateParams(dateRange);
    const filter = JSON.stringify([{ field: 'adset.id', operator: 'IN', value: [adSetId] }]);

    const [adsData, insightsData] = await Promise.all([
      this.get<any>(token, `/${adSetId}/ads`, {
        fields: 'id,name,status,creative{thumbnail_url,title,body,image_url,object_story_spec}',
        limit: '100',
      }),
      this.get<any>(token, `/${accountId}/insights`, {
        fields: 'ad_id,impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
        level: 'ad', filtering: filter, limit: '200', ...d,
      }),
    ]);

    const iMap = new Map<string, any>();
    for (const ins of insightsData.data ?? []) iMap.set(ins.ad_id, ins);

    return (adsData.data ?? []).map((ad: any) => {
      const ins = iMap.get(ad.id);
      const cr = ad.creative ?? {};
      const spec = cr.object_story_spec ?? {};
      // Vídeo: thumbnail_url do creative às vezes vem vazio — o video_data
      // dentro do object_story_spec tem sua própria imagem de capa como
      // segunda fonte. Presença de video_data também é o sinal de "é vídeo".
      const isVideo = !!spec.video_data;
      const spend = Number(ins?.spend ?? 0);
      const mensagens = this.action(ins?.actions, 'onsite_conversion.total_messaging_connection');
      const compras = this.purchases(ins?.actions);
      const valorCompras = this.purchaseValue(ins?.action_values);
      const engajamentos = this.engagements(ins?.actions);
      const visualizacoesPagina = this.landingPageViews(ins?.actions);
      return {
        id: ad.id,
        nome: ad.name,
        status: ad.status,
        criativo: {
          thumbnail: cr.thumbnail_url ?? cr.image_url ?? spec.video_data?.image_url ?? null,
          tipo: isVideo ? 'video' : 'imagem',
          titulo: cr.title ?? null,
          texto: cr.body ?? null,
        },
        impressoes: Number(ins?.impressions ?? 0),
        cliques: Number(ins?.clicks ?? 0),
        custo: `R$ ${spend.toFixed(2)}`,
        ctr: `${Number(ins?.ctr ?? 0).toFixed(2)}%`,
        cpm: `R$ ${Number(ins?.cpm ?? 0).toFixed(2)}`,
        alcance: Number(ins?.reach ?? 0),
        visualizacoes_pagina: visualizacoesPagina,
        mensagens,
        custo_por_mensagem: mensagens > 0 ? `R$ ${(spend / mensagens).toFixed(2)}` : 'Sem conversões',
        compras,
        valor_compras: `R$ ${valorCompras.toFixed(2)}`,
        roas: spend > 0 ? Number((valorCompras / spend).toFixed(2)) : 0,
        custo_por_compra: compras > 0 ? `R$ ${(spend / compras).toFixed(2)}` : 'Sem compras',
        engajamentos,
        custo_por_engajamento: engajamentos > 0 ? `R$ ${(spend / engajamentos).toFixed(2)}` : 'Sem engajamento',
      };
    });
  }

  // ─── Demographics ─────────────────────────────────────────────────────────

  async getDemographics(token: string, accountId: string, campaignId: string, dateRange = 'LAST_30_DAYS') {
    const d = this.dateParams(dateRange);
    const filter = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]);
    const base = { level: 'campaign', filtering: filter, ...d };

    const [ageData, genderData] = await Promise.all([
      this.get<any>(token, `/${accountId}/insights`, {
        fields: 'impressions,clicks,spend,actions', breakdowns: 'age', ...base,
      }),
      this.get<any>(token, `/${accountId}/insights`, {
        fields: 'impressions,clicks,spend,actions', breakdowns: 'gender', ...base,
      }),
    ]);

    const GENDER: Record<string, string> = { male: 'Masculino', female: 'Feminino', unknown: 'Desconhecido' };

    const toItem = (r: any, labelKey: string, labelMap?: Record<string, string>) => ({
      label: (labelMap ? labelMap[r[labelKey]] : null) ?? r[labelKey] ?? 'N/A',
      impressoes: Number(r.impressions ?? 0),
      cliques: Number(r.clicks ?? 0),
      custo: Number(r.spend ?? 0).toFixed(2),
      conversoes: this.action(r.actions, 'onsite_conversion.total_messaging_connection'),
    });

    return {
      idade: (ageData.data ?? [])
        .filter((r: any) => Number(r.impressions) > 0)
        .sort((a: any, b: any) => Number(b.impressions) - Number(a.impressions))
        .map((r: any) => toItem(r, 'age')),
      genero: (genderData.data ?? [])
        .filter((r: any) => Number(r.impressions) > 0)
        .map((r: any) => toItem(r, 'gender', GENDER)),
      renda: [],
    };
  }

  // ─── Day of week ──────────────────────────────────────────────────────────

  async getDayOfWeek(token: string, accountId: string, campaignId: string, dateRange = 'LAST_30_DAYS') {
    const d = this.dateParams(dateRange);
    const filter = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]);

    const data = await this.get<any>(token, `/${accountId}/insights`, {
      fields: 'impressions,clicks,spend,actions',
      level: 'campaign', filtering: filter, time_increment: '1', ...d,
    });

    const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const ORDER = [1, 2, 3, 4, 5, 6, 0];
    const byDay: Record<number, any> = {};

    for (const r of data.data ?? []) {
      const date = new Date(`${r.date_start}T12:00:00Z`);
      const idx = date.getUTCDay();
      if (!byDay[idx]) byDay[idx] = { impressoes: 0, cliques: 0, custo: 0, conversoes: 0 };
      byDay[idx].impressoes += Number(r.impressions ?? 0);
      byDay[idx].cliques += Number(r.clicks ?? 0);
      byDay[idx].custo += Number(r.spend ?? 0);
      byDay[idx].conversoes += this.action(r.actions, 'onsite_conversion.total_messaging_connection');
    }

    return ORDER.map(idx => ({
      dia: DAY_LABELS[idx],
      impressoes: byDay[idx]?.impressoes ?? 0,
      cliques: byDay[idx]?.cliques ?? 0,
      custo: `R$ ${(byDay[idx]?.custo ?? 0).toFixed(2)}`,
      conversoes: byDay[idx]?.conversoes ?? 0,
    }));
  }

  // ─── Devices ──────────────────────────────────────────────────────────────

  async getDevices(token: string, accountId: string, campaignId: string, dateRange = 'LAST_30_DAYS') {
    const d = this.dateParams(dateRange);
    const filter = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]);

    const data = await this.get<any>(token, `/${accountId}/insights`, {
      fields: 'impressions,clicks,spend,reach,actions',
      breakdowns: 'device_platform', level: 'campaign', filtering: filter, ...d,
    });

    const DEVICES: Record<string, string> = {
      mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablet',
      connected_tv: 'TV Conectada', unknown: 'Outros',
    };

    return (data.data ?? [])
      .map((r: any) => ({
        dispositivo: DEVICES[r.device_platform] ?? r.device_platform,
        impressoes: Number(r.impressions ?? 0),
        cliques: Number(r.clicks ?? 0),
        custo: `R$ ${Number(r.spend ?? 0).toFixed(2)}`,
        conversoes: this.action(r.actions, 'onsite_conversion.total_messaging_connection'),
        ctr: Number(r.impressions) > 0
          ? `${((Number(r.clicks) / Number(r.impressions)) * 100).toFixed(2)}%` : '0.00%',
      }))
      .sort((a: any, b: any) => b.impressoes - a.impressoes);
  }

  // ─── Placements (publisher platforms) ────────────────────────────────────

  async getPlacements(token: string, accountId: string, campaignId: string, dateRange = 'LAST_30_DAYS') {
    const d = this.dateParams(dateRange);
    const filter = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [campaignId] }]);

    const data = await this.get<any>(token, `/${accountId}/insights`, {
      fields: 'impressions,clicks,spend,reach,actions',
      breakdowns: 'publisher_platform', level: 'campaign', filtering: filter, ...d,
    });

    const PLATFORMS: Record<string, string> = {
      facebook: 'Facebook', instagram: 'Instagram',
      audience_network: 'Audience Network', messenger: 'Messenger', whatsapp: 'WhatsApp',
    };

    return (data.data ?? [])
      .map((r: any) => ({
        plataforma: PLATFORMS[r.publisher_platform] ?? r.publisher_platform,
        impressoes: Number(r.impressions ?? 0),
        cliques: Number(r.clicks ?? 0),
        custo: `R$ ${Number(r.spend ?? 0).toFixed(2)}`,
        alcance: Number(r.reach ?? 0),
        conversoes: this.action(r.actions, 'onsite_conversion.total_messaging_connection'),
        ctr: Number(r.impressions) > 0
          ? `${((Number(r.clicks) / Number(r.impressions)) * 100).toFixed(2)}%` : '0.00%',
      }))
      .sort((a: any, b: any) => b.impressoes - a.impressoes);
  }
}
