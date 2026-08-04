import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * Um registro por acesso (pageview) — sem dedup na gravação, o "único" é
 * calculado na leitura via COUNT(DISTINCT visitorId). Guarda também as UTMs
 * daquele acesso específico, pra dar o breakdown de origem.
 */
@Entity('tracked_url_access_event')
@Index(['trackedUrlId', 'date'])
export class TrackedUrlAccessEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  trackedUrlId: number;

  /** yyyy-MM-dd, sempre em horário de Brasília */
  @Column({ type: 'varchar' })
  date: string;

  /** id anônimo gerado no navegador (localStorage) — sem nenhum dado pessoal. */
  @Column({ type: 'varchar' })
  visitorId: string;

  @Column({ type: 'varchar', nullable: true })
  utmSource: string | null;

  @Column({ type: 'varchar', nullable: true })
  utmMedium: string | null;

  @Column({ type: 'varchar', nullable: true })
  utmCampaign: string | null;
}
