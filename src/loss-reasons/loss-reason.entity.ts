import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('loss_reasons')
export class LossReason {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  /** Desativar em vez de excluir preserva o histórico de leads já marcados com este motivo. */
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
