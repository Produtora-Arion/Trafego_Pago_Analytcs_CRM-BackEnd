import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/** URL cadastrada pra rastrear acessos e envios de formulário — não vinculada a nenhum cliente/conta do CRM. */
@Entity('tracked_urls')
export class TrackedUrl {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  url: string;

  /** URL-friendly, gerado no cadastro — identifica os eventos vindos dessa URL. */
  @Column({ unique: true })
  slug: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
