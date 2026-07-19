import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_stages')
export class CrmStage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerId: string;

  @Column()
  label: string;

  @Column({ default: '#6b7280' })
  color: string;

  @Column({ default: 0 })
  position: number;

  @Column({ default: false })
  triggersConversion: boolean;

  /** Etapa que recebe novos leads do webhook (só uma por cliente) */
  @Column({ default: false })
  isEntryStage: boolean;

  /** Código curto (6 chars, A-Z+dígitos) gerado uma vez na criação — identificador visível e imutável exibido na coluna. Nunca usado para lógica, só o `id` é a FK real. */
  @Column({ length: 6, nullable: true })
  code: string;
}
