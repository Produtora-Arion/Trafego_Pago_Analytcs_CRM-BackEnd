import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('webhook_tokens')
export class WebhookToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  customerId: string;

  @Column({ unique: true })
  token: string;

  /** URL-friendly slug: {nome-sanitizado}-{8 hex chars}  ex: patricia-digital-a3f9e2bc */
  @Column({ unique: true, nullable: true, type: 'varchar' })
  slug: string | null;

  @Column({ default: true })
  active: boolean;

  /** ID da ação de conversão do Google Ads DESTA conta — cada cliente tem a sua própria. */
  @Column({ nullable: true, type: 'varchar' })
  conversionActionId: string | null;

  /**
   * Token de acesso do Meta (Graph API) desta conta — cada cliente tem o seu
   * próprio Business Manager, então não dá pra usar um token central único
   * (diferente do Google Ads, que usa uma MCC compartilhada). Idealmente um
   * token de Usuário de Sistema do BM do próprio cliente, sem expiração curta.
   */
  @Column({ nullable: true, type: 'varchar' })
  metaAccessToken: string | null;

  /** ID da conta de anúncio do Meta (formato "act_123...") padrão desta conta. */
  @Column({ nullable: true, type: 'varchar' })
  metaAdAccountId: string | null;

  /**
   * Nome de exibição — só é usado por clientes "só Meta" (sem conta no Google
   * Ads da MCC), já que pra esses não existe nome nenhum vindo de lá. Clientes
   * que têm Google Ads continuam mostrando o nome da conta do Google.
   */
  @Column({ nullable: true, type: 'varchar' })
  accountName: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
