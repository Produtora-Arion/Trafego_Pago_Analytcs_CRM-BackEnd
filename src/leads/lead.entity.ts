import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export type LeadStatus = string; // label da etapa CRM (customizável por cliente)

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  name: string;

  // Click IDs
  @Column({ nullable: true })
  gclid: string;

  @Column({ nullable: true })
  fbclid: string;

  // UTM tracking
  @Column({ nullable: true })
  utmSource: string;

  @Column({ nullable: true })
  utmMedium: string;

  @Column({ nullable: true })
  utmCampaign: string;

  @Column({ nullable: true })
  utmContent: string;

  @Column({ nullable: true })
  utmTerm: string;

  @Column({ nullable: true })
  landingPage: string;

  // Contexto técnico do envio
  @Column({ nullable: true })
  referrer: string;

  @Column({ nullable: true })
  ip: string;

  @Column({ nullable: true })
  userAgent: string;

  @Column({ nullable: true })
  browserLanguage: string;

  @Column({ nullable: true })
  sessionId: string;

  /** Campos personalizados extras enviados pelo formulário (JSON) */
  @Column({ nullable: true, type: 'text' })
  extraData: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  conversionActionId: string;

  /**
   * Referência estável e imutável à etapa do CRM (CrmStage.id) — nunca muda
   * quando a etapa é renomeada ou reordenada. É a fonte de verdade de "em
   * qual etapa este lead está"; `status` abaixo é só o nome para exibição,
   * mantido em sincronia mas nunca usado para decidir a coluna do lead.
   */
  @Column({ nullable: true })
  stageId: number;

  @Column({ default: 'Novo' })
  status: LeadStatus;

  /** Quando o lead entrou na etapa atual (usado para calcular "tempo na etapa") */
  @Column({ nullable: true })
  statusChangedAt: Date;

  @Column({ nullable: true, type: 'real' })
  conversionValue: number;

  @Column({ nullable: true })
  firstMessage: string;

  /** Resposta da pergunta de múltipla escolha do formulário (varia por cliente) */
  @Column({ nullable: true })
  formChoice: string;

  @CreateDateColumn()
  firstContactAt: Date;

  @Column({ nullable: true })
  convertedAt: Date;

  @Column({ nullable: true })
  conversionUploadedAt: Date;

  /** Lembretes definidos manualmente — até 3 por lead. JSON: [{id, date, text}] */
  @Column({ nullable: true, type: 'text' })
  reminders: string;
}
