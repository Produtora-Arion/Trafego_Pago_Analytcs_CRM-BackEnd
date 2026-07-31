import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlDailyMetric } from './tracked-url-daily-metric.entity';
import { TrackedUrlVisitor } from './tracked-url-visitor.entity';
import { TrackedUrlFormSubmission } from './tracked-url-form-submission.entity';
import { UpdateTrackedUrlDto } from './tracked-urls.dto';

const MAX_VISITOR_ID_LEN = 100;
const MAX_FORM_DATA_LEN = 10_000;

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

export type TrackedUrlWithTotals = TrackedUrl & {
  totalAccess: number;
  totalUnique: number;
  totalClick: number;
  totalForm: number;
};

export type TrackedUrlMetricDay = {
  date: string;
  accessCount: number;
  uniqueCount: number;
  clickCount: number;
  formCount: number;
};

@Injectable()
export class TrackedUrlsService {
  constructor(
    @InjectRepository(TrackedUrl)
    private readonly repo: Repository<TrackedUrl>,
    @InjectRepository(TrackedUrlDailyMetric)
    private readonly metricRepo: Repository<TrackedUrlDailyMetric>,
    @InjectRepository(TrackedUrlVisitor)
    private readonly visitorRepo: Repository<TrackedUrlVisitor>,
    @InjectRepository(TrackedUrlFormSubmission)
    private readonly submissionRepo: Repository<TrackedUrlFormSubmission>,
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

    const [accessClick, uniques, forms] = await Promise.all([
      this.metricRepo
        .createQueryBuilder('m')
        .select('m.trackedUrlId', 'trackedUrlId')
        .addSelect('SUM(m.accessCount)', 'totalAccess')
        .addSelect('SUM(m.clickCount)', 'totalClick')
        .groupBy('m.trackedUrlId')
        .getRawMany(),
      this.visitorRepo
        .createQueryBuilder('v')
        .select('v.trackedUrlId', 'trackedUrlId')
        .addSelect('COUNT(*)', 'totalUnique')
        .groupBy('v.trackedUrlId')
        .getRawMany(),
      this.submissionRepo
        .createQueryBuilder('s')
        .select('s.trackedUrlId', 'trackedUrlId')
        .addSelect('COUNT(*)', 'totalForm')
        .groupBy('s.trackedUrlId')
        .getRawMany(),
    ]);
    const acMap = new Map(accessClick.map(r => [Number(r.trackedUrlId), r]));
    const uMap = new Map(uniques.map(r => [Number(r.trackedUrlId), r]));
    const fMap = new Map(forms.map(r => [Number(r.trackedUrlId), r]));

    return urls.map(u => ({
      ...u,
      totalAccess: Number(acMap.get(u.id)?.totalAccess ?? 0),
      totalClick: Number(acMap.get(u.id)?.totalClick ?? 0),
      totalUnique: Number(uMap.get(u.id)?.totalUnique ?? 0),
      totalForm: Number(fMap.get(u.id)?.totalForm ?? 0),
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
    await this.visitorRepo.delete({ trackedUrlId: id });
    await this.submissionRepo.delete({ trackedUrlId: id });
    await this.repo.delete({ id });
    return { success: true };
  }

  private async findActiveBySlug(slug: string): Promise<TrackedUrl | null> {
    return this.repo.findOne({ where: { slug, active: true } });
  }

  /** Pageview — sempre soma no total do dia; se vier visitorId, também registra pro contador de únicos. */
  async recordAccess(slug: string, visitorId?: string): Promise<boolean> {
    const entry = await this.findActiveBySlug(slug);
    if (!entry) return false;

    const date = todayBrasilia();
    await this.metricRepo.query(
      `INSERT INTO tracked_url_daily_metric ("trackedUrlId", date, "accessCount")
       VALUES ($1, $2, 1)
       ON CONFLICT ("trackedUrlId", date) DO UPDATE SET "accessCount" = tracked_url_daily_metric."accessCount" + 1`,
      [entry.id, date],
    );

    const vid = visitorId?.trim().slice(0, MAX_VISITOR_ID_LEN);
    if (vid) {
      await this.visitorRepo.query(
        `INSERT INTO tracked_url_visitor ("trackedUrlId", date, "visitorId")
         VALUES ($1, $2, $3)
         ON CONFLICT ("trackedUrlId", date, "visitorId") DO NOTHING`,
        [entry.id, date, vid],
      );
    }
    return true;
  }

  async recordClick(slug: string): Promise<boolean> {
    const entry = await this.findActiveBySlug(slug);
    if (!entry) return false;

    await this.metricRepo.query(
      `INSERT INTO tracked_url_daily_metric ("trackedUrlId", date, "clickCount")
       VALUES ($1, $2, 1)
       ON CONFLICT ("trackedUrlId", date) DO UPDATE SET "clickCount" = tracked_url_daily_metric."clickCount" + 1`,
      [entry.id, todayBrasilia()],
    );
    return true;
  }

  /** Salva o formulário enviado — guarda os dados brutos (respeitando um limite de tamanho). */
  async recordForm(slug: string, data: unknown): Promise<boolean> {
    const entry = await this.findActiveBySlug(slug);
    if (!entry) return false;

    const safeData = data && typeof data === 'object' ? data : {};
    const json = JSON.stringify(safeData).slice(0, MAX_FORM_DATA_LEN);

    const submission = this.submissionRepo.create({
      trackedUrlId: entry.id,
      date: todayBrasilia(),
      data: json,
    });
    await this.submissionRepo.save(submission);
    return true;
  }

  async getMetrics(id: number, from?: string, to?: string): Promise<TrackedUrlMetricDay[]> {
    const byDate = new Map<string, TrackedUrlMetricDay>();
    const ensure = (date: string) => {
      let d = byDate.get(date);
      if (!d) { d = { date, accessCount: 0, uniqueCount: 0, clickCount: 0, formCount: 0 }; byDate.set(date, d); }
      return d;
    };

    const dailyQb = this.metricRepo.createQueryBuilder('m').where('m.trackedUrlId = :id', { id });
    if (from) dailyQb.andWhere('m.date >= :from', { from });
    if (to) dailyQb.andWhere('m.date <= :to', { to });
    for (const r of await dailyQb.getMany()) {
      const d = ensure(r.date);
      d.accessCount = r.accessCount;
      d.clickCount = r.clickCount;
    }

    const uniqueQb = this.visitorRepo
      .createQueryBuilder('v')
      .select('v.date', 'date').addSelect('COUNT(*)', 'count')
      .where('v.trackedUrlId = :id', { id })
      .groupBy('v.date');
    if (from) uniqueQb.andWhere('v.date >= :from', { from });
    if (to) uniqueQb.andWhere('v.date <= :to', { to });
    for (const r of await uniqueQb.getRawMany()) {
      ensure(r.date).uniqueCount = Number(r.count);
    }

    const formQb = this.submissionRepo
      .createQueryBuilder('s')
      .select('s.date', 'date').addSelect('COUNT(*)', 'count')
      .where('s.trackedUrlId = :id', { id })
      .groupBy('s.date');
    if (from) formQb.andWhere('s.date >= :from', { from });
    if (to) formQb.andWhere('s.date <= :to', { to });
    for (const r of await formQb.getRawMany()) {
      ensure(r.date).formCount = Number(r.count);
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getSubmissions(id: number, from?: string, to?: string): Promise<{ id: number; data: any; createdAt: Date }[]> {
    const qb = this.submissionRepo
      .createQueryBuilder('s')
      .where('s.trackedUrlId = :id', { id })
      .orderBy('s.createdAt', 'DESC')
      .limit(200);
    if (from) qb.andWhere('s.date >= :from', { from });
    if (to) qb.andWhere('s.date <= :to', { to });
    const rows = await qb.getMany();
    return rows.map(r => {
      let data: any = {};
      try { data = JSON.parse(r.data); } catch { data = { raw: r.data }; }
      return { id: r.id, data, createdAt: r.createdAt };
    });
  }
}
