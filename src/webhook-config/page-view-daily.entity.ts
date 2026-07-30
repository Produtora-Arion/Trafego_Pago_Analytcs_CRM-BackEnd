import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/** Contagem de acessos por dia da LP de cada cliente — um registro por (customerId, date). */
@Entity('page_view_daily')
@Index(['customerId', 'date'], { unique: true })
export class PageViewDaily {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerId: string;

  /** yyyy-MM-dd, sempre em horário de Brasília */
  @Column({ type: 'varchar' })
  date: string;

  @Column({ default: 0 })
  count: number;
}
