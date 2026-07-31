import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/** Contagem diária de acessos (totais) e cliques de uma tracked_url. */
@Entity('tracked_url_daily_metric')
@Index(['trackedUrlId', 'date'], { unique: true })
export class TrackedUrlDailyMetric {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  trackedUrlId: number;

  /** yyyy-MM-dd, sempre em horário de Brasília */
  @Column({ type: 'varchar' })
  date: string;

  @Column({ default: 0 })
  accessCount: number;

  @Column({ default: 0 })
  clickCount: number;
}
