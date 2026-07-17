import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { WebhookToken } from './webhook-token.entity';

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

  async validateToken(token: string): Promise<string | null> {
    if (!token) return null;
    const entry = await this.repo.findOne({ where: { token, active: true } });
    return entry ? entry.customerId : null;
  }

  async validateSlug(slug: string): Promise<string | null> {
    if (!slug) return null;
    const entry = await this.repo.findOne({ where: { slug, active: true } });
    return entry ? entry.customerId : null;
  }
}
