import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
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

const ENC_ALGO = 'aes-256-gcm';

@Injectable()
export class WebhookConfigService {
  private readonly logger = new Logger('WebhookConfig');

  constructor(
    @InjectRepository(WebhookToken)
    private readonly repo: Repository<WebhookToken>,
    @InjectRepository(PageViewDaily)
    private readonly pageViewRepo: Repository<PageViewDaily>,
    private readonly config: ConfigService,
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

  // ─── Criptografia do token do Meta ─────────────────────────────────────────
  // Guardado no banco só cifrado (AES-256-GCM — autenticado, detecta adulteração,
  // não só leitura). A chave nunca fica no banco, só numa env var — quem tiver
  // acesso ao Postgres sem a chave vê apenas ruído ilegível, não o token real.

  private getEncryptionKey(): Buffer {
    const raw = this.config.getOrThrow<string>('META_TOKEN_ENCRYPTION_KEY');
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32) {
      throw new Error('META_TOKEN_ENCRYPTION_KEY precisa ter 64 caracteres hex (32 bytes) — gere com crypto.randomBytes(32).toString("hex")');
    }
    return key;
  }

  private encryptToken(plain: string): string {
    const key = this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENC_ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
  }

  /** Retorna null (em vez de derrubar a tela) se o valor não puder ser decifrado — ex:
   * chave trocada, dado corrompido. Loga pra investigar, mas nunca quebra o admin. */
  private decryptToken(stored: string): string | null {
    try {
      const [ivHex, tagHex, dataHex] = stored.split(':');
      const key = this.getEncryptionKey();
      const decipher = createDecipheriv(ENC_ALGO, key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error('Falha ao decifrar metaAccessToken — chave trocada ou dado corrompido?', (err as Error)?.stack);
      return null;
    }
  }

  /** Devolve a entidade com metaAccessToken/hotmartHottok em texto plano, pronta
   * pra quem já está autorizado (admin) a ver/usar — a cifra protege o banco, não o admin. */
  private toPublic(entry: WebhookToken): WebhookToken {
    return {
      ...entry,
      metaAccessToken: entry.metaAccessToken ? this.decryptToken(entry.metaAccessToken) : entry.metaAccessToken,
      hotmartHottok: entry.hotmartHottok ? this.decryptToken(entry.hotmartHottok) : entry.hotmartHottok,
    };
  }

  async getOrCreate(customerId: string, accountName?: string): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    if (existing) {
      if (!existing.slug && accountName) {
        existing.slug = this.generateSlug(accountName);
        return this.toPublic(await this.repo.save(existing));
      }
      return this.toPublic(existing);
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: accountName ? this.generateSlug(accountName) : null,
    });
    return this.toPublic(await this.repo.save(entry));
  }

  async regenerate(customerId: string, accountName?: string): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    const newSlug = this.generateSlug(accountName || customerId);
    const newToken = this.generateToken();

    if (existing) {
      existing.token = newToken;
      existing.slug = newSlug;
      return this.toPublic(await this.repo.save(existing));
    }
    const entry = this.repo.create({ customerId, token: newToken, slug: newSlug });
    return this.toPublic(await this.repo.save(entry));
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
      return this.toPublic(await this.repo.save(existing));
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: this.generateSlug(customerId),
      conversionActionId,
    });
    return this.toPublic(await this.repo.save(entry));
  }

  /**
   * Credenciais do Meta (Graph API) desta conta — cada cliente tem seu próprio
   * Business Manager, então o token nunca é compartilhado entre clientes
   * (diferente do Google Ads, que usa uma MCC central). Retorna null se o
   * cliente ainda não configurou nada — quem chama decide o que fazer.
   */
  async getMetaConfig(customerId: string): Promise<{ accessToken: string | null; adAccountId: string | null }> {
    const entry = await this.repo.findOne({ where: { customerId } });
    if (!entry?.metaAccessToken) return { accessToken: null, adAccountId: entry?.metaAdAccountId ?? null };
    return { accessToken: this.decryptToken(entry.metaAccessToken), adAccountId: entry.metaAdAccountId ?? null };
  }

  async updateMetaConfig(
    customerId: string,
    patch: { accessToken?: string; adAccountId?: string },
  ): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    const encryptedToken = patch.accessToken !== undefined
      ? (patch.accessToken ? this.encryptToken(patch.accessToken) : null)
      : undefined;

    if (existing) {
      if (encryptedToken !== undefined) existing.metaAccessToken = encryptedToken;
      if (patch.adAccountId !== undefined) existing.metaAdAccountId = patch.adAccountId || null;
      return this.toPublic(await this.repo.save(existing));
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: this.generateSlug(customerId),
      metaAccessToken: encryptedToken || null,
      metaAdAccountId: patch.adAccountId || null,
    });
    return this.toPublic(await this.repo.save(entry));
  }

  /**
   * Configuração da integração Hotmart → Meta Conversions API desta conta:
   * Hottok (autentica o webhook) + Pixel ID (destino do evento de Compra).
   */
  async getHotmartConfig(customerId: string): Promise<{ hottok: string | null; pixelId: string | null; metaAccessToken: string | null }> {
    const entry = await this.repo.findOne({ where: { customerId } });
    return {
      hottok: entry?.hotmartHottok ? this.decryptToken(entry.hotmartHottok) : null,
      pixelId: entry?.metaPixelId ?? null,
      metaAccessToken: entry?.metaAccessToken ? this.decryptToken(entry.metaAccessToken) : null,
    };
  }

  async updateHotmartConfig(
    customerId: string,
    patch: { hottok?: string; pixelId?: string },
  ): Promise<WebhookToken> {
    const existing = await this.repo.findOne({ where: { customerId } });
    const encryptedHottok = patch.hottok !== undefined
      ? (patch.hottok ? this.encryptToken(patch.hottok) : null)
      : undefined;

    if (existing) {
      if (encryptedHottok !== undefined) existing.hotmartHottok = encryptedHottok;
      if (patch.pixelId !== undefined) existing.metaPixelId = patch.pixelId || null;
      return this.toPublic(await this.repo.save(existing));
    }
    const entry = this.repo.create({
      customerId,
      token: this.generateToken(),
      slug: this.generateSlug(customerId),
      hotmartHottok: encryptedHottok || null,
      metaPixelId: patch.pixelId || null,
    });
    return this.toPublic(await this.repo.save(entry));
  }

  /**
   * Cria um cliente "só Meta" — sem conta correspondente na MCC do Google Ads
   * (ex: um produto próprio, ou um cliente cujo Google ainda não foi
   * conectado). O customerId é gerado aqui (prefixo "meta-" garante que nunca
   * colide com um customerId numérico de conta do Google Ads).
   */
  async createMetaOnlyClient(
    accountName: string,
    patch: { accessToken: string; adAccountId: string },
  ): Promise<WebhookToken> {
    const customerId = `meta-${this.sanitizeName(accountName)}-${randomBytes(3).toString('hex')}`;
    const entry = this.repo.create({
      customerId,
      accountName,
      token: this.generateToken(),
      slug: this.generateSlug(accountName),
      metaAccessToken: this.encryptToken(patch.accessToken),
      metaAdAccountId: patch.adAccountId,
    });
    return this.toPublic(await this.repo.save(entry));
  }

  /** Todos os clientes que têm Meta configurado — base pro seletor unificado (Google + Meta). */
  async listMetaClients(): Promise<{ customerId: string; accountName: string | null }[]> {
    const rows = await this.repo
      .createQueryBuilder('w')
      .select(['w.customerId', 'w.accountName'])
      .where('w.metaAccessToken IS NOT NULL')
      .getMany();
    return rows.map((r) => ({ customerId: r.customerId, accountName: r.accountName }));
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
