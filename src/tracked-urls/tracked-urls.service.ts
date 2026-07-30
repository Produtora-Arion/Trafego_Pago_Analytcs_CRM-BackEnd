import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlDailyMetric } from './tracked-url-daily-metric.entity';
import { UpdateTrackedUrlDto } from './tracked-urls.dto';

function todayBrasilia(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function removeAccents(str: string): string {
  return Array.from(str).map(c => {
    const code = c.charCodeAt(0);
    if ((code >= 0xC0 && code <= 0xC5) || (code >= 0xE0 && code <= 0xE5)) return 'a';
    if ((code >= 0xC8 && code <= 0xCB) || (code >= 0xE8 && code <= 0xEB)) return 'e';
    if ((code >= 0xCC && code <= 0xCF) || (code >= 0xEC && code <= 0xEF)) return 'i';
    if ((code >= 0xD2 && code <= 0xD6) || (code >= 0xF2 && code <= 0xF6)) return 'o';
    if ((code >= 0xD9 && code <= 0xDC) || (code >= 0xF9 && code <= 0xFC)) return 'u';
    if (code === 0xC7 || code === 0xE7) return 'c';
    if (code === 0xD1 || code === 0xF1) return 'n';
    return c;
  }).join('');
}

export type TrackedUrlWithTotals = TrackedUrl & { totalAccess: number; totalForm: number };

@Injectable()
export class TrackedUrlsService {
  constructor(
    @InjectRepository(TrackedUrl)
    private readonly repo: Repository<TrackedUrl>,
    @InjectRepository(TrackedUrlDailyMetric)
    private readonly metricRepo: Repository<TrackedUrlDailyMetric>,
  ) {}

  private generateSlug(name: string): string {
    const sanitized = removeAccents(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const code = randomBytes(4).toString('hex');
    return sanitized ? `${sanitized}-${code}` : `url-${code}`;
  }

  async create(name: string, url: string): Promise<TrackedUrl> {
    const entry = this.repo.create({ name, url, slug: this.generateSlug(name) });
    return this.repo.save(entry);
  }

  async findAll(): Promise<TrackedUrlWithTotals[]> {
    const urls = await this.repo.find({ order: { createdAt: 'DESC' } });
    if (urls.length === 0) return [];

    const totals = await this.metricRepo
      .createQueryBuilder('m')
      .select('m.trackedUrlId', 'trackedUrlId')
      .addSelect('SUM(m.accessCount)', 'totalAccess')
      .addSelect('SUM(m.formCount)', 'totalForm')
      .groupBy('m.trackedUrlId')
      .getRawMany();
    const byId = new Map(totals.map(t => [Number(t.trackedUrlId), t]));

    return urls.map(u => ({
      ...u,
      totalAccess: Number(byId.get(u.id)?.totalAccess ?? 0),
      totalForm: Number(byId.get(u.id)?.totalForm ?? 0),
    }));
  }

  async update(id: number, patch: UpdateTrackedUrlDto): Promise<TrackedUrl> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('URL não encontrada');
    Object.assign(entry, patch);
    return this.repo.save(entry);
  }

  async delete(id: number): Promise<{ success: boolean }> {
    await this.metricRepo.delete({ trackedUrlId: id });
    await this.repo.delete({ id });
    return { success: true };
  }

  /** Chamado pelo endpoint público — incrementa o contador de hoje pra esse slug/evento. */
  async recordEvent(slug: string, event: 'access' | 'form'): Promise<boolean> {
    const entry = await this.repo.findOne({ where: { slug, active: true } });
    if (!entry) return false;

    const column = event === 'access' ? 'accessCount' : 'formCount';
    await this.metricRepo.query(
      `INSERT INTO tracked_url_daily_metric ("trackedUrlId", date, "${column}")
       VALUES ($1, $2, 1)
       ON CONFLICT ("trackedUrlId", date) DO UPDATE SET "${column}" = tracked_url_daily_metric."${column}" + 1`,
      [entry.id, todayBrasilia()],
    );
    return true;
  }

  async getMetrics(
    id: number,
    from?: string,
    to?: string,
  ): Promise<{ date: string; accessCount: number; formCount: number }[]> {
    const qb = this.metricRepo
      .createQueryBuilder('m')
      .where('m.trackedUrlId = :id', { id })
      .orderBy('m.date', 'ASC');
    if (from) qb.andWhere('m.date >= :from', { from });
    if (to) qb.andWhere('m.date <= :to', { to });
    const rows = await qb.getMany();
    return rows.map(r => ({ date: r.date, accessCount: r.accessCount, formCount: r.formCount }));
  }
}
