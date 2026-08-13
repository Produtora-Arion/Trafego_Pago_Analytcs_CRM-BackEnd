import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * Um evento de botão — "click" (a pessoa clicou) ou "view" (o botão apareceu na
 * tela dela). O "label" identifica QUAL botão (ex: "whatsapp", "agendar").
 */
@Entity('tracked_url_button_event')
@Index(['trackedUrlId', 'date'])
export class TrackedUrlButtonEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  trackedUrlId: number;

  /** yyyy-MM-dd, sempre em horário de Brasília */
  @Column({ type: 'varchar' })
  date: string;

  /** Nome do botão/CTA, definido pelo próprio site na chamada do pixel (ex: "whatsapp"). */
  @Column({ type: 'varchar' })
  label: string;

  /** 'click' | 'view' */
  @Column({ type: 'varchar' })
  type: string;
}
