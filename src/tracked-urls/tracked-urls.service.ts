import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlDailyMetric } from './tracked-url-daily-metric.entity';
import { TrackedUrlAccessEvent } from './tracked-url-access-event.entity';
import { TrackedUrlFormSubmission } from './tracked-url-form-submission.entity';
import { UpdateTrackedUrlDto } from './tracked-urls.dto';

const MAX_VISITOR_ID_LEN = 100;
const MAX_UTM_LEN = 150;
const MAX_FORM_DATA_LEN = 10_000;
const DIRECT_LABEL = '(direto)';

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

function cleanUtm(v?: string): string | null {
  const t = v?.trim().slice(0, MAX_UTM_LEN);
  return t ? t : null;
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

export type TrackedUrlUtmRow = {
  source: string;
  medium: string;
  campaign: string;
  totalAccess: number;
  uniqueAccess: number;
};

@Injectable()
export class TrackedUrlsService {
  constructor(
    @InjectRepository(TrackedUrl)
    private readonly repo: Repository<TrackedUrl>,
    @InjectRepository(TrackedUrlDailyMetric)
    private readonly metricRepo: Repository<TrackedUrlDailyMetric>,
    @InjectRepository(TrackedUrlAccessEvent)
    private readonly accessRepo: Repository<TrackedUrlAccessEvent>,
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

    const [access, clicks, forms] = await Promise.all([
      this.accessRepo
        .createQueryBuilder('a')
        .select('a.trackedUrlId', 'trackedUrlId')
        .addSelect('COUNT(*)', 'totalAccess')
        .addSelect('COUNT(DISTINCT a.visitorId)', 'totalUnique')
        .groupBy('a.trackedUrlId')
        .getRawMany(),
      this.metricRepo
        .createQueryBuilder('m')
        .select('m.trackedUrlId', 'trackedUrlId')
        .addSelect('SUM(m.clickCount)', 'totalClick')
        .groupBy('m.trackedUrlId')
        .getRawMany(),
      this.submissionRepo
        .createQueryBuilder('s')
        .select('s.trackedUrlId', 'trackedUrlId')
        .addSelect('COUNT(*)', 'totalForm')
        .groupBy('s.trackedUrlId')
        .getRawMany(),
    ]);
    const aMap = new Map(access.map(r => [Number(r.trackedUrlId), r]));
    const cMap = new Map(clicks.map(r => [Number(r.trackedUrlId), r]));
    const fMap = new Map(forms.map(r => [Number(r.trackedUrlId), r]));

    return urls.map(u => ({
      ...u,
      totalAccess: Number(aMap.get(u.id)?.totalAccess ?? 0),
      totalUnique: Number(aMap.get(u.id)?.totalUnique ?? 0),
      totalClick: Number(cMap.get(u.id)?.totalClick ?? 0),
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
    await this.accessRepo.delete({ trackedUrlId: id });
    await this.submissionRepo.delete({ trackedUrlId: id });
    await this.repo.delete({ id });
    return { success: true };
  }

  private async findActiveBySlug(slug: string): Promise<TrackedUrl | null> {
    return this.repo.findOne({ where: { slug, active: true } });
  }

  /** Pageview — grava um evento por acesso (não dedupa na escrita; "único" é calculado na leitura). */
  async recordAccess(
    slug: string,
    visitorId: string | undefined,
    utmSource?: string,
    utmMedium?: string,
    utmCampaign?: string,
  ): Promise<boolean> {
    const entry = await this.findActiveBySlug(slug);
    if (!entry) return false;

    const vid = visitorId?.trim().slice(0, MAX_VISITOR_ID_LEN) || 'sem-id';
    const event = this.accessRepo.create({
      trackedUrlId: entry.id,
      date: todayBrasilia(),
      visitorId: vid,
      utmSource: cleanUtm(utmSource),
      utmMedium: cleanUtm(utmMedium),
      utmCampaign: cleanUtm(utmCampaign),
    });
    await this.accessRepo.save(event);
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

    const accessQb = this.accessRepo
      .createQueryBuilder('a')
      .select('a.date', 'date')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(DISTINCT a.visitorId)', 'unique')
      .where('a.trackedUrlId = :id', { id })
      .groupBy('a.date');
    if (from) accessQb.andWhere('a.date >= :from', { from });
    if (to) accessQb.andWhere('a.date <= :to', { to });
    for (const r of await accessQb.getRawMany()) {
      const d = ensure(r.date);
      d.accessCount = Number(r.total);
      d.uniqueCount = Number(r.unique);
    }

    const clickQb = this.metricRepo.createQueryBuilder('m').where('m.trackedUrlId = :id', { id });
    if (from) clickQb.andWhere('m.date >= :from', { from });
    if (to) clickQb.andWhere('m.date <= :to', { to });
    for (const r of await clickQb.getMany()) {
      ensure(r.date).clickCount = r.clickCount;
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

  /** Breakdown de acessos por UTM (source/medium/campaign) — total e único, no período. */
  async getUtmBreakdown(id: number, from?: string, to?: string): Promise<TrackedUrlUtmRow[]> {
    const qb = this.accessRepo
      .createQueryBuilder('a')
      .select('a.utmSource', 'source')
      .addSelect('a.utmMedium', 'medium')
      .addSelect('a.utmCampaign', 'campaign')
      .addSelect('COUNT(*)', 'totalAccess')
      .addSelect('COUNT(DISTINCT a.visitorId)', 'uniqueAccess')
      .where('a.trackedUrlId = :id', { id })
      .groupBy('a.utmSource')
      .addGroupBy('a.utmMedium')
      .addGroupBy('a.utmCampaign')
      .orderBy('"totalAccess"', 'DESC');
    if (from) qb.andWhere('a.date >= :from', { from });
    if (to) qb.andWhere('a.date <= :to', { to });
    const rows = await qb.getRawMany();
    return rows.map(r => ({
      source: r.source ?? DIRECT_LABEL,
      medium: r.medium ?? DIRECT_LABEL,
      campaign: r.campaign ?? DIRECT_LABEL,
      totalAccess: Number(r.totalAccess),
      uniqueAccess: Number(r.uniqueAccess),
    }));
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
