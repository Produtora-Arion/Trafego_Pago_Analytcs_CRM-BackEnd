import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Quais campanhas (Google e/ou Meta) entram no relatório mensal de cada
 * cliente — configurado uma vez pela Pâmela, pra não incluir campanha de
 * teste/antiga por engano. Sem nenhuma linha pra um cliente, o relatório
 * cai no padrão (todas as campanhas ativas daquela conta).
 */
@Entity('report_campaign_selections')
export class ReportCampaignSelection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerId: string;

  @Column({ type: 'varchar' })
  platform: 'google' | 'meta';

  /** ID da campanha (Google) ou da campanha Meta — nunca o ID da conta/ad account. */
  @Column()
  campaignId: string;

  /** Nome no momento em que foi selecionada — só referência visual na tela de configuração. */
  @Column({ nullable: true })
  campaignName: string | null;

  /** Pra Meta, a campanha pertence a um ad account específico — precisa pra consultar a API depois. */
  @Column({ nullable: true })
  accountId: string | null;
}
