import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * Relatório mensal gerado pra um cliente — sempre criado como rascunho
 * (releasedToClient=false), visível só pra admin. A liberação pro cliente é
 * uma ação explícita e separada (PATCH .../release), nunca automática.
 *
 * Os dados (weeklyData/summaryData/insights) são uma FOTO do momento em que
 * foi gerado — não recalculam sozinhos depois. Se a Pâmela quiser dado mais
 * recente, gera um relatório novo; o antigo fica como estava, histórico real.
 */
@Entity('monthly_reports')
export class MonthlyReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerId: string;

  /** Formato 'YYYY-MM' */
  @Column()
  month: string;

  /** Nomes das campanhas incluídas nesta geração (foto, não referência viva) — pro cabeçalho do relatório. */
  @Column({ type: 'text' })
  campaignNames: string;

  /** JSON: { semanas: [...], totais: {...} } — ver ReportsService.generate() pro formato exato. */
  @Column({ type: 'text' })
  summaryData: string;

  /** Texto gerado a partir do dado real (comparações entre semanas) — nunca inventado, sempre calculado. */
  @Column({ type: 'text', nullable: true })
  autoInsights: string | null;

  /** Observações livres da Pâmela — só ela escreve, mas aparece pro cliente quando liberado. */
  @Column({ type: 'text', nullable: true })
  observations: string | null;

  @Column({ default: false })
  releasedToClient: boolean;

  @Column({ nullable: true })
  releasedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  updatedAt: Date;
}
