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

  /** Id anônimo do visitante (localStorage) — usado pra contar visualizações únicas. */
  @Column({ type: 'varchar' })
  visitorId: string;

  /** Posição do elemento entre os `[data-track]` da página no momento do evento — usada
   * só pra ordenar os botões no relatório na mesma ordem em que aparecem no site. */
  @Column({ type: 'int', nullable: true })
  pos: number | null;

  /** UTM da URL no momento do clique/visualização — mesma origem que já é capturada no
   * acesso, mas aqui por botão: mostra qual campanha/anúncio gerou aquele clique/view. */
  @Column({ type: 'varchar', nullable: true })
  utmSource: string | null;

  @Column({ type: 'varchar', nullable: true })
  utmMedium: string | null;

  @Column({ type: 'varchar', nullable: true })
  utmCampaign: string | null;

  /**
   * Destino real do clique (ex: "https://pay.hotmart.com/..." ou a própria
   * página + "#comprar") — capturado do .href resolvido pelo navegador, sem
   * precisar marcar nada a mais no HTML. Distingue automaticamente um botão
   * que leva pra outra página/venda de um que só rola a mesma página. Null em
   * cliques registrados antes dessa coluna existir, ou em elementos sem href
   * (ex: um <button> sem link).
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  href: string | null;
}
