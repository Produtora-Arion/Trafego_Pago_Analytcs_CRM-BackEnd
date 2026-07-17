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
  @Column({ unique: true, nullable: true })
  slug: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
