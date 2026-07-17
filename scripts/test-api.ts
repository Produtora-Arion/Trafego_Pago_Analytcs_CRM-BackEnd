import * as dotenv from 'dotenv';
import { GoogleAdsApi } from 'google-ads-api';

dotenv.config();

async function test() {
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_DEVELOPER_TOKEN!,
  });

  const mccId = process.env.GOOGLE_MCC_CUSTOMER_ID!;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;

  console.log('\n══════════════════════════════════════════');
  console.log('[1] CONTAS GERENCIADAS pela MCC');
  console.log('══════════════════════════════════════════');
  let accountIds: string[] = [];
  try {
    const mcc = client.Customer({ customer_id: mccId, refresh_token: refreshToken });
    const accounts = await mcc.query(`
      SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code
      FROM customer_client
      WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'
    `);
    accounts.forEach(a => {
      console.log(`  ✓ [${a.customer_client.id}] ${a.customer_client.descriptive_name} (${a.customer_client.currency_code})`);
      accountIds.push(String(a.customer_client.id));
    });
  } catch (e: any) {
    console.error('  ✗', e?.errors?.[0]?.message || e?.message);
  }

  for (const cid of accountIds) {
    console.log(`\n══════════════════════════════════════════`);
    console.log(`[2] VISÃO GERAL — conta ${cid}`);
    console.log('══════════════════════════════════════════');
    try {
      const customer = client.Customer({ customer_id: cid, refresh_token: refreshToken, login_customer_id: mccId });
      const rows = await customer.query(`
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM customer
        WHERE segments.date DURING LAST_30_DAYS
      `);
      if (rows[0]) {
        const m = rows[0].metrics;
        console.log(`  ✓ Impressões: ${m.impressions} | Cliques: ${m.clicks} | Custo: R$${(Number(m.cost_micros)/1e6).toFixed(2)} | Conversões: ${m.conversions}`);
      } else {
        console.log('  ✓ Sem dados no período');
      }
    } catch (e: any) {
      console.error('  ✗', e?.errors?.[0]?.message || e?.message);
    }

    console.log(`\n[3] CAMPANHAS — conta ${cid}`);
    console.log('──────────────────────────────────────────');
    let campaignId: string | undefined;
    try {
      const customer = client.Customer({ customer_id: cid, refresh_token: refreshToken, login_customer_id: mccId });
      const rows = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status, metrics.clicks, metrics.cost_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
      `);
      console.log(`  ✓ Total: ${rows.length} campanhas`);
      rows.forEach(r => {
        console.log(`    - [${r.campaign.id}] ${r.campaign.name} | ${r.campaign.status} | Cliques: ${r.metrics.clicks}`);
        if (!campaignId) campaignId = String(r.campaign.id);
      });
    } catch (e: any) {
      console.error('  ✗', e?.errors?.[0]?.message || e?.message);
    }

    if (campaignId) {
      console.log(`\n[4] DETALHES DA CAMPANHA ${campaignId}`);
      console.log('──────────────────────────────────────────');
      try {
        const customer = client.Customer({ customer_id: cid, refresh_token: refreshToken, login_customer_id: mccId });
        const [r] = await customer.query(`
          SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
          FROM campaign
          WHERE campaign.id = ${campaignId}
            AND segments.date DURING LAST_30_DAYS
        `);
        if (r) console.log(`  ✓ ${r.campaign.name}: ${r.metrics.impressions} impressões, ${r.metrics.clicks} cliques`);
      } catch (e: any) {
        console.error('  ✗', e?.errors?.[0]?.message || e?.message);
      }

      console.log(`\n[5] GRUPOS DE ANÚNCIO — campanha ${campaignId}`);
      console.log('──────────────────────────────────────────');
      try {
        const customer = client.Customer({ customer_id: cid, refresh_token: refreshToken, login_customer_id: mccId });
        const rows = await customer.query(`
          SELECT ad_group.id, ad_group.name, ad_group.status, metrics.clicks
          FROM ad_group
          WHERE campaign.id = ${campaignId}
            AND ad_group.status != 'REMOVED'
            AND segments.date DURING LAST_30_DAYS
          ORDER BY metrics.clicks DESC
        `);
        console.log(`  ✓ Total: ${rows.length} grupos`);
        rows.slice(0, 3).forEach(r => console.log(`    - ${r.ad_group.name} | ${r.ad_group.status}`));
      } catch (e: any) {
        console.error('  ✗', e?.errors?.[0]?.message || e?.message);
      }

      console.log(`\n[6] PALAVRAS-CHAVE — campanha ${campaignId}`);
      console.log('──────────────────────────────────────────');
      try {
        const customer = client.Customer({ customer_id: cid, refresh_token: refreshToken, login_customer_id: mccId });
        const rows = await customer.query(`
          SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.clicks, metrics.cost_micros
          FROM keyword_view
          WHERE ad_group_criterion.status != 'REMOVED'
            AND campaign.id = ${campaignId}
            AND segments.date DURING LAST_30_DAYS
          ORDER BY metrics.cost_micros DESC
          LIMIT 5
        `);
        console.log(`  ✓ Top ${rows.length} palavras-chave:`);
        rows.forEach(r => console.log(`    - "${r.ad_group_criterion.keyword.text}" [${r.ad_group_criterion.keyword.match_type}] | Cliques: ${r.metrics.clicks}`));
      } catch (e: any) {
        console.error('  ✗', e?.errors?.[0]?.message || e?.message);
      }
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log('Testes concluídos.');
  console.log('══════════════════════════════════════════\n');
}

test().catch(console.error);
