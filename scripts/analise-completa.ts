import * as dotenv from 'dotenv';
import { GoogleAdsApi } from 'google-ads-api';

dotenv.config();

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  developer_token: process.env.GOOGLE_DEVELOPER_TOKEN!,
});

const mccId = process.env.GOOGLE_MCC_CUSTOMER_ID!;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;

function sep(titulo: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${titulo}`);
  console.log('═'.repeat(60));
}
function sub(titulo: string) {
  console.log(`\n  ── ${titulo}`);
}
function linha() { console.log('  ' + '─'.repeat(58)); }

function brl(micros: any) {
  return `R$ ${((Number(micros) || 0) / 1_000_000).toFixed(2)}`;
}
function pct(val: any) {
  return `${((Number(val) || 0) * 100).toFixed(2)}%`;
}

const STATUS_CAMP: any = { 1: 'UNSPECIFIED', 2: '✅ ATIVA', 3: '⏸ PAUSADA', 4: '🗑 REMOVIDA' };
const STATUS_AG: any   = { 2: '✅ ATIVA', 3: '⏸ PAUSADA', 4: '🗑 REMOVIDA' };
const MATCH: any       = { 1: 'UNSPECIFIED', 2: 'AMPLA', 3: 'FRASE', 4: 'EXATA' };
const DEVICE: any      = { 2: 'Computador', 3: 'Celular', 4: 'Tablet', 6: 'TV' };

async function analisar(cid: string, nomeConta: string) {
  const customer = client.Customer({ customer_id: cid, refresh_token: refreshToken, login_customer_id: mccId });

  sep(`CONTA: ${nomeConta}  [${cid}]`);

  // ─── VISÃO GERAL ───────────────────────────────────────────
  sub('VISÃO GERAL — Últimos 30 dias');
  try {
    const rows = await customer.query(`
      SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc, metrics.conversions,
             metrics.cost_per_conversion, metrics.search_impression_share
      FROM customer
      WHERE segments.date DURING LAST_30_DAYS
    `);
    if (rows[0]) {
      const m = rows[0].metrics;
      const clicks = Number(m.clicks);
      const conv   = Number(m.conversions);
      console.log(`  Impressões:         ${Number(m.impressions).toLocaleString('pt-BR')}`);
      console.log(`  Cliques:            ${clicks.toLocaleString('pt-BR')}`);
      console.log(`  Custo total:        ${brl(m.cost_micros)}`);
      console.log(`  CTR:                ${pct(m.ctr)}`);
      console.log(`  CPC Médio:          ${brl(m.average_cpc)}`);
      console.log(`  Conversões:         ${conv}`);
      console.log(`  Custo/Conversão:    ${conv > 0 ? brl(m.cost_per_conversion) : 'sem conversões'}`);
      console.log(`  Taxa de Conversão:  ${clicks > 0 ? ((conv/clicks)*100).toFixed(2)+'%' : '0%'}`);
      console.log(`  Share Impressões:   ${pct(m.search_impression_share)}`);
    }
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── CAMPANHAS ─────────────────────────────────────────────
  sub('CAMPANHAS');
  let campanhas: any[] = [];
  try {
    const rows = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.status,
             campaign.bidding_strategy_type, campaign.advertising_channel_type,
             campaign_budget.amount_micros,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc, metrics.conversions,
             metrics.search_impression_share,
             metrics.search_budget_lost_impression_share,
             metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC
    `);
    campanhas = rows;
    rows.forEach((r, i) => {
      const m = r.metrics;
      linha();
      console.log(`  [${i+1}] ${r.campaign.name}`);
      console.log(`      ID:                  ${r.campaign.id}`);
      console.log(`      Status:              ${STATUS_CAMP[r.campaign.status as number] || r.campaign.status}`);
      console.log(`      Canal:               ${r.campaign.advertising_channel_type}`);
      console.log(`      Estratégia de Lance: ${r.campaign.bidding_strategy_type}`);
      console.log(`      Orçamento Diário:    ${brl(r.campaign_budget?.amount_micros)}`);
      console.log(`      Impressões:          ${Number(m.impressions).toLocaleString('pt-BR')}`);
      console.log(`      Cliques:             ${Number(m.clicks).toLocaleString('pt-BR')}`);
      console.log(`      Custo:               ${brl(m.cost_micros)}`);
      console.log(`      CTR:                 ${pct(m.ctr)}`);
      console.log(`      CPC Médio:           ${brl(m.average_cpc)}`);
      console.log(`      Conversões:          ${Number(m.conversions)}`);
      console.log(`      Share Impressões:    ${pct(m.search_impression_share)}`);
      console.log(`      Perdas Orçamento:    ${pct(m.search_budget_lost_impression_share)}`);
      console.log(`      Perdas Ranking:      ${pct(m.search_rank_lost_impression_share)}`);
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── PALAVRAS-CHAVE POSITIVAS ───────────────────────────────
  sep('PALAVRAS-CHAVE POSITIVAS');
  try {
    const rows = await customer.query(`
      SELECT ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             ad_group_criterion.status,
             ad_group_criterion.quality_info.quality_score,
             ad_group_criterion.quality_info.creative_quality_score,
             ad_group_criterion.quality_info.post_click_quality_score,
             ad_group_criterion.quality_info.search_predicted_ctr,
             ad_group.name, campaign.name,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc, metrics.conversions
      FROM keyword_view
      WHERE ad_group_criterion.status != 'REMOVED'
        AND segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC
      LIMIT 100
    `);
    console.log(`\n  Total: ${rows.length} palavras-chave\n`);
    rows.forEach(r => {
      const kw = r.ad_group_criterion;
      const m  = r.metrics;
      const qs = kw.quality_info?.quality_score;
      console.log(`  "${kw.keyword.text}"`);
      console.log(`    Tipo:          ${MATCH[kw.keyword.match_type as number] || kw.keyword.match_type}`);
      console.log(`    Status:        ${kw.status}`);
      console.log(`    Campanha:      ${r.campaign.name}`);
      console.log(`    Grupo:         ${r.ad_group.name}`);
      console.log(`    Índice Qual.:  ${qs || 'N/A'}${qs ? '/10' : ''}`);
      console.log(`    CTR Previsto:  ${kw.quality_info?.search_predicted_ctr || 'N/A'}`);
      console.log(`    Impressões:    ${Number(m.impressions).toLocaleString('pt-BR')}`);
      console.log(`    Cliques:       ${Number(m.clicks)}`);
      console.log(`    Custo:         ${brl(m.cost_micros)}`);
      console.log(`    CTR:           ${pct(m.ctr)}`);
      console.log(`    CPC Médio:     ${brl(m.average_cpc)}`);
      console.log(`    Conversões:    ${Number(m.conversions)}`);
      linha();
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── PALAVRAS-CHAVE NEGATIVAS (campanha) ───────────────────
  sep('PALAVRAS-CHAVE NEGATIVAS — Nível Campanha');
  try {
    const rows = await customer.query(`
      SELECT campaign_criterion.keyword.text,
             campaign_criterion.keyword.match_type,
             campaign_criterion.negative,
             campaign.name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.negative = true
        AND campaign.status != 'REMOVED'
    `);
    if (!rows.length) { console.log('\n  Nenhuma palavra-chave negativa em nível de campanha.'); }
    let campAtual = '';
    rows.forEach(r => {
      if (r.campaign.name !== campAtual) {
        campAtual = r.campaign.name as string;
        console.log(`\n  Campanha: ${campAtual}`);
      }
      const kw = r.campaign_criterion.keyword;
      console.log(`    ❌ "${kw.text}"  [${MATCH[kw.match_type as number] || kw.match_type}]`);
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── PALAVRAS-CHAVE NEGATIVAS (grupo) ──────────────────────
  sep('PALAVRAS-CHAVE NEGATIVAS — Nível Grupo de Anúncio');
  try {
    const rows = await customer.query(`
      SELECT ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             ad_group.name, campaign.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = true
        AND ad_group_criterion.status != 'REMOVED'
    `);
    if (!rows.length) { console.log('\n  Nenhuma palavra-chave negativa em nível de grupo.'); }
    let agAtual = '';
    rows.forEach(r => {
      const chave = `${r.campaign.name} > ${r.ad_group.name}`;
      if (chave !== agAtual) {
        agAtual = chave;
        console.log(`\n  ${chave}`);
      }
      const kw = r.ad_group_criterion.keyword;
      console.log(`    ❌ "${kw.text}"  [${MATCH[kw.match_type as number] || kw.match_type}]`);
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── PÚBLICOS / AUDIENCES ───────────────────────────────────
  sep('PÚBLICOS (AUDIENCES) — Targeting');
  try {
    const rows = await customer.query(`
      SELECT ad_group_criterion.type,
             ad_group_criterion.status,
             ad_group_criterion.bid_modifier,
             ad_group_criterion.user_list.user_list,
             ad_group_criterion.user_interest.user_interest_category,
             ad_group.name, campaign.name
      FROM ad_group_criterion
      WHERE ad_group_criterion.type IN ('USER_LIST','USER_INTEREST')
        AND ad_group_criterion.status != 'REMOVED'
    `);
    if (!rows.length) { console.log('\n  Nenhum público configurado nos grupos de anúncio.'); }
    rows.forEach(r => {
      const c = r.ad_group_criterion;
      console.log(`\n  Campanha: ${r.campaign.name}`);
      console.log(`  Grupo:    ${r.ad_group.name}`);
      console.log(`  Tipo:     ${c.type}`);
      console.log(`  Status:   ${c.status}`);
      if (c.bid_modifier) console.log(`  Ajuste de Lance: ${((Number(c.bid_modifier)-1)*100).toFixed(0)}%`);
      if (c.user_list?.user_list) console.log(`  Lista:    ${c.user_list.user_list}`);
      if (c.user_interest?.user_interest_category) console.log(`  Interesse: ${c.user_interest.user_interest_category}`);
      linha();
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── AJUSTES DE LANCE POR DISPOSITIVO ──────────────────────
  sep('AJUSTES DE LANCE POR DISPOSITIVO');
  try {
    const rows = await customer.query(`
      SELECT campaign_criterion.device.type,
             campaign_criterion.bid_modifier,
             campaign.name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'DEVICE'
        AND campaign.status != 'REMOVED'
    `);
    if (!rows.length) { console.log('\n  Sem ajustes de dispositivo configurados.'); }
    let campAtual = '';
    rows.forEach(r => {
      if (r.campaign.name !== campAtual) {
        campAtual = r.campaign.name as string;
        console.log(`\n  Campanha: ${campAtual}`);
      }
      const device = DEVICE[r.campaign_criterion.device?.type as number] || r.campaign_criterion.device?.type;
      const mod = Number(r.campaign_criterion.bid_modifier);
      const ajuste = mod === 0 ? '🚫 Excluído' : mod === 1 ? 'Sem ajuste' : `${((mod-1)*100).toFixed(0)}%`;
      console.log(`    ${device}: ${ajuste}`);
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── AJUSTES DE LANCE POR LOCAL ─────────────────────────────
  sep('TARGETING DE LOCALIZAÇÃO');
  try {
    const rows = await customer.query(`
      SELECT campaign_criterion.location.geo_target_constant,
             campaign_criterion.bid_modifier,
             campaign_criterion.negative,
             campaign.name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'LOCATION'
        AND campaign.status != 'REMOVED'
    `);
    if (!rows.length) { console.log('\n  Sem localizações configuradas.'); }
    let campAtual = '';
    rows.forEach(r => {
      if (r.campaign.name !== campAtual) {
        campAtual = r.campaign.name as string;
        console.log(`\n  Campanha: ${campAtual}`);
      }
      const neg = r.campaign_criterion.negative ? '❌ EXCLUÍDA' : '✅ Incluída';
      console.log(`    ${neg}: ${r.campaign_criterion.location?.geo_target_constant}`);
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── ANÚNCIOS ───────────────────────────────────────────────
  sep('ANÚNCIOS (Responsivos de Pesquisa)');
  try {
    const rows = await customer.query(`
      SELECT ad_group_ad.ad.id,
             ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions,
             ad_group_ad.ad.final_urls,
             ad_group_ad.status,
             ad_group_ad.policy_summary.approval_status,
             ad_group.name, campaign.name,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
        AND segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC
    `);
    rows.forEach((r, i) => {
      const ad  = r.ad_group_ad.ad;
      const rsa = ad?.responsive_search_ad;
      const m   = r.metrics;
      console.log(`\n  [${i+1}] Campanha: ${r.campaign.name}`);
      console.log(`      Grupo: ${r.ad_group.name}`);
      console.log(`      Status: ${r.ad_group_ad.status} | Aprovação: ${r.ad_group_ad.policy_summary?.approval_status}`);
      if (rsa?.headlines?.length) {
        console.log(`      Títulos:`);
        rsa.headlines.slice(0, 5).forEach((h: any) => console.log(`        - ${h.text}`));
      }
      if (rsa?.descriptions?.length) {
        console.log(`      Descrições:`);
        rsa.descriptions.slice(0, 2).forEach((d: any) => console.log(`        - ${d.text}`));
      }
      if (ad?.final_urls?.length) console.log(`      URL: ${ad.final_urls[0]}`);
      console.log(`      Impressões: ${Number(m.impressions).toLocaleString('pt-BR')} | Cliques: ${Number(m.clicks)} | CTR: ${pct(m.ctr)} | Custo: ${brl(m.cost_micros)}`);
      linha();
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  // ─── GRUPOS DE ANÚNCIO ──────────────────────────────────────
  sep('GRUPOS DE ANÚNCIO');
  try {
    const rows = await customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
             ad_group.cpc_bid_micros,
             campaign.name,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
        AND segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC
    `);
    rows.forEach(r => {
      const m = r.metrics;
      console.log(`\n  ${r.campaign.name} > ${r.ad_group.name}`);
      console.log(`    Status: ${STATUS_AG[r.ad_group.status as number] || r.ad_group.status}`);
      console.log(`    Tipo:   ${r.ad_group.type}`);
      console.log(`    Lance CPC: ${brl(r.ad_group.cpc_bid_micros)}`);
      console.log(`    Impressões: ${Number(m.impressions).toLocaleString('pt-BR')} | Cliques: ${Number(m.clicks)} | Custo: ${brl(m.cost_micros)} | Conv: ${Number(m.conversions)}`);
    });
  } catch(e: any) { console.error('  Erro:', e?.errors?.[0]?.message || e?.message); }

  sep(`FIM DA ANÁLISE — ${nomeConta}`);
}

async function main() {
  const mcc = client.Customer({ customer_id: mccId, refresh_token: refreshToken });
  const accounts = await mcc.query(`
    SELECT customer_client.id, customer_client.descriptive_name
    FROM customer_client
    WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'
  `);

  for (const a of accounts) {
    await analisar(String(a.customer_client.id), a.customer_client.descriptive_name as string);
  }
}

main().catch(console.error);
