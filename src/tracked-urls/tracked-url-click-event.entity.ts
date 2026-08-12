import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/** Um clique registrado — o "label" identifica QUAL botão foi clicado (ex: "whatsapp", "agendar"). */
@Entity('tracked_url_click_event')
@Index(['trackedUrlId', 'date'])
export class TrackedUrlClickEvent {
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
}
