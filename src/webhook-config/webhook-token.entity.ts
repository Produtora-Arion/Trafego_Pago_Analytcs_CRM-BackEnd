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
   * ID da ação de conversão (secundária, não-biddable) que registra "lead
   * enviou o formulário" — disparada na criação do lead, dá mais contexto de
   * funil pro Google sem competir com "Ganho" (conversionActionId acima) pela
   * otimização do lance. Ver caso Patricia: motivo de ter as duas.
   */
  @Column({ nullable: true, type: 'varchar' })
  formSubmittedConversionActionId: string | null;

  /**
   * ID da ação de conversão (secundária, não-biddable) que registra "lead foi
   * perdido" — disparada só quando o motivo da perda é "Fantasma" (lead
   * falso/sem valor real). Perda por motivo de negócio legítimo (preço, não
   * se enquadra, documentação) não dispara — é tráfego bom que só não
   * fechou, reportar isso ensinaria o Google a evitar tráfego de qualidade.
   */
  @Column({ nullable: true, type: 'varchar' })
  lostConversionActionId: string | null;

  /**
   * Nome de exibição — só é usado por clientes "só Meta" (sem conta no Google
   * Ads da MCC), já que pra esses não existe nome nenhum vindo de lá. Clientes
   * que têm Google Ads continuam mostrando o nome da conta do Google.
   */
  @Column({ nullable: true, type: 'varchar' })
  accountName: string | null;

  /**
   * Hottok (token de verificação) do webhook da Hotmart desta conta — cifrado
   * do mesmo jeito que o metaAccessToken, nunca em texto puro no banco. Usado
   * pra confirmar que um aviso de venda realmente veio da Hotmart.
   */
  @Column({ nullable: true, type: 'varchar' })
  hotmartHottok: string | null;

  /** ID do Pixel do Meta desta conta — destino dos eventos de Compra (Conversions API). */
  @Column({ nullable: true, type: 'varchar' })
  metaPixelId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
