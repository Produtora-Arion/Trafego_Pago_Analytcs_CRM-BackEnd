import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * Um registro por visitante distinto/dia — usado só pra contar "acessos únicos".
 * visitorId é um id anônimo gerado no navegador (localStorage), sem nenhum dado pessoal.
 */
@Entity('tracked_url_visitor')
@Index(['trackedUrlId', 'date', 'visitorId'], { unique: true })
export class TrackedUrlVisitor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  trackedUrlId: number;

  /** yyyy-MM-dd, sempre em horário de Brasília */
  @Column({ type: 'varchar' })
  date: string;

  @Column({ type: 'varchar' })
  visitorId: string;
}
