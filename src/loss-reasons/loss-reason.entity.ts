import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * 'fantasma' e 'desqualificado' marcam os 2 motivos fixos que disparam o
 * sinal "Lead Desqualificado" pro Google Ads (ver LeadsController.lose) —
 * nunca criados/alterados via API, só pela seed automática (ver
 * DEFAULT_REASONS em loss-reasons.service.ts) e pela migração que
 * backfilled os clientes já existentes. 'default' é qualquer motivo normal,
 * customizável livremente pelo cliente (inclusive o "Sem Enquadramento"
 * semeado por padrão — esse não dispara nada, só é uma sugestão pronta).
 */
export type LossReasonKind = 'default' | 'fantasma' | 'desqualificado';

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

  @Column({ default: 'default', type: 'varchar' })
  kind: LossReasonKind;

  @CreateDateColumn()
  createdAt: Date;
}
