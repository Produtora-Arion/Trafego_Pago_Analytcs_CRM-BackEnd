import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Unique } from 'typeorm';

/** Uma venda aprovada na Hotmart — registrada aqui pra aparecer no CRM, além
 * de ser mandada como conversão real pro Meta (Conversions API). */
@Entity('hotmart_sales')
@Unique(['customerId', 'transactionId'])
export class HotmartSale {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerId: string;

  /** ID da transação na Hotmart — evita registrar a mesma venda duas vezes
   * (a Hotmart pode reenviar o mesmo webhook). */
  @Column()
  transactionId: string;

  @Column({ nullable: true, type: 'varchar' })
  buyerName: string | null;

  @Column({ nullable: true, type: 'varchar' })
  buyerEmail: string | null;

  @Column({ type: 'real', default: 0 })
  value: number;

  @Column({ nullable: true, type: 'varchar' })
  currency: string | null;

  /** Se null, a venda não pôde ser ligada a nenhum clique de anúncio rastreado. */
  @Column({ nullable: true, type: 'varchar' })
  fbclid: string | null;

  /**
   * De onde veio a venda, pra exibição — "Anúncio Meta" (tem fbclid), a
   * origem lida do link (ex: "instagram-bio", quando a página foi aberta a
   * partir de um link marcado na bio), ou null quando não veio marcado
   * (acesso direto/orgânico sem nenhuma origem identificável).
   */
  @Column({ nullable: true, type: 'varchar' })
  channel: string | null;

  @Column({ default: false })
  metaSent: boolean;

  /** Detalhe do envio (sucesso ou motivo da falha) — só pra depuração interna. */
  @Column({ nullable: true, type: 'text' })
  metaSentDetail: string | null;

  /** Payload bruto da Hotmart, guardado pra depuração — nunca exibido no frontend. */
  @Column({ nullable: true, type: 'text' })
  rawPayload: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
