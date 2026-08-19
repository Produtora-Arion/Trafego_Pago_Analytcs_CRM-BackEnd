import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { WebhookToken } from './webhook-token.entity';
import { PageViewDaily } from './page-view-daily.entity';

/** yyyy-MM-dd em horário de Brasília, independente do timezone do servidor. */
function todayBrasilia(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function removeAccents(str: string): string {
  return Array.from(str).map(c => {
    const code = c.charCodeAt(0);
    // a: À-Å (Uppercase) | à-å (lowercase) | ã Ã (tilde)
    if ((code >= 0xC0 && code <= 0xC5) || (code >= 0xE0 && code <= 0xE5)) return 'a';
    // e: È-Ë | è-ë
    if ((code >= 0xC8 && code <= 0xCB) || (code >= 0xE8 && code <= 0xEB)) return 'e';
    // i: Ì-Ï | ì-ï
    if ((code >= 0xCC && code <= 0xCF) || (code >= 0xEC && code <= 0xEF)) return 'i';
    // o: Ò-Ö | ò-ö
    if ((code >= 0xD2 && code <= 0xD6) || (code >= 0xF2 && code <= 0xF6)) return 'o';
    // u: Ù-Ü | ù-ü
    if ((code >= 0xD9 && code <= 0xDC) || (code >= 0xF9 && code <= 0xFC)) return 'u';
    // c: Ç | ç
    if (code === 0xC7 || code === 0xE7) return 'c';
    // n: Ñ | ñ
    if (code === 0xD1 || code === 0xF1) return 'n';
    return c;
  }).join('');
}

@Injectable()
export class WebhookConfigService {
  constructor(
    @InjectRepository(WebhookToken)
    private readonly repo: Repository<WebhookToken>,
    @InjectRepository(PageViewDaily)
    private readonly pageViewRepo: Repository<PageViewDaily>,
  ) {}

  private generateToken(): string {
    return 'wh_' + randomBytes(24).toString('hex');
  }

  private sanitizeName(name: string): string {
    return removeAccents(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
  }

  private generateSlug(name: string): string {
    const sanitized = this.sanitizeName(name);
    const code = randomBytes(4).toString('hex');
    return sanitized ? `${sanitized}-${code}` : `wh-${code}`;
  }

  async getOrCreate(customerId: string, accountName?: string): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    if (existing) {
      if (!existing.slug && accountName) {
        existing.slug = this.generateSlug(accountName);
        return this.repo.save(existing);
      }
      return existing;
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: accountName ? this.generateSlug(accountName) : null,
    });
    return this.repo.save(entry);
  }

  async regenerate(customerId: string, accountName?: string): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    const newSlug = this.generateSlug(accountName || customerId);
    const newToken = this.generateToken();

    if (existing) {
      existing.token = newToken;
      existing.slug = newSlug;
      return this.repo.save(existing);
    }
    const entry = this.repo.create({ customerId, token: newToken, slug: newSlug });
    return this.repo.save(entry);
  }

  async validateSlug(slug: string): Promise<string | null> {
    if (!slug) return null;
    const entry = await this.repo.findOne({ where: { slug, active: true } });
    return entry ? entry.customerId : null;
  }

  /**
   * ID da ação de conversão do Google Ads configurada para este cliente.
   * Não cria linha nova — se o cliente nunca configurou, retorna null (quem
   * chama decide o fallback). Cada cliente tem sua própria conta Google Ads,
   * então esse valor nunca pode ser compartilhado entre clientes.
   */
  async getConversionActionId(customerId: string): Promise<string | null> {
    const entry = await this.repo.findOne({ where: { customerId } });
    return entry?.conversionActionId ?? null;
  }

  async updateConversionActionId(customerId: string, conversionActionId: string): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    if (existing) {
      existing.conversionActionId = conversionActionId;
      return this.repo.save(existing);
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: this.generateSlug(customerId),
      conversionActionId,
    });
    return this.repo.save(entry);
  }

  /**
   * Credenciais do Meta (Graph API) desta conta — cada cliente tem seu próprio
   * Business Manager, então o token nunca é compartilhado entre clientes
   * (diferente do Google Ads, que usa uma MCC central). Retorna null se o
   * cliente ainda não configurou nada — quem chama decide o que fazer.
   */
  async getMetaConfig(customerId: string): Promise<{ accessToken: string | null; adAccountId: string | null }> {
    const entry = await this.repo.findOne({ where: { customerId } });
    return { accessToken: entry?.metaAccessToken ?? null, adAccountId: entry?.metaAdAccountId ?? null };
  }

  async updateMetaConfig(
    customerId: string,
    patch: { accessToken?: string; adAccountId?: string },
  ): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    if (existing) {
      if (patch.accessToken !== undefined) existing.metaAccessToken = patch.accessToken || null;
      if (patch.adAccountId !== undefined) existing.metaAdAccountId = patch.adAccountId || null;
      return this.repo.save(existing);
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: this.generateSlug(customerId),
      metaAccessToken: patch.accessToken || null,
      metaAdAccountId: patch.adAccountId || null,
    });
    return this.repo.save(entry);
  }

  /** Chamado pelo endpoint público — incrementa o contador de acessos de hoje pra esse slug. */
  async recordPageView(slug: string): Promise<boolean> {
    const customerId = await this.validateSlug(slug);
    if (!customerId) return false;

    await this.pageViewRepo.query(
      `INSERT INTO page_view_daily ("customerId", date, count)
       VALUES ($1, $2, 1)
       ON CONFLICT ("customerId", date) DO UPDATE SET count = page_view_daily.count + 1`,
      [customerId, todayBrasilia()],
    );
    return true;
  }

  async getPageViewStats(
    customerId: string,
    from?: string,
    to?: string,
  ): Promise<{ date: string; count: number }[]> {
    const qb = this.pageViewRepo
      .createQueryBuilder('pv')
      .where('pv.customerId = :customerId', { customerId })
      .orderBy('pv.date', 'ASC');
    if (from) qb.andWhere('pv.date >= :from', { from });
    if (to) qb.andWhere('pv.date <= :to', { to });
    const rows = await qb.getMany();
    return rows.map(r => ({ date: r.date, count: r.count }));
  }
}
