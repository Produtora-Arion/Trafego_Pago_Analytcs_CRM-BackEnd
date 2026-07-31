import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/** Um envio de formulário recebido de uma tracked_url, com os dados enviados. */
@Entity('tracked_url_form_submission')
export class TrackedUrlFormSubmission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  trackedUrlId: number;

  /** yyyy-MM-dd, sempre em horário de Brasília — usado só pra agrupar no relatório por dia. */
  @Column({ type: 'varchar' })
  date: string;

  /** JSON com os campos enviados pelo formulário (o que o snippet mandou). */
  @Column({ type: 'text' })
  data: string;

  @CreateDateColumn()
  createdAt: Date;
}
