import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Mapeia um código curto (grudado no link de checkout da Hotmart, no campo
 * "src") pro gclid/fbclid de verdade — que é grande demais pra caber lá.
 * Quando a Hotmart avisa a venda aprovada, ela devolve esse código curto de
 * volta; usamos ele pra recuperar o clique original e mandar pro Meta.
 */
@Entity('hotmart_click_refs')
export class HotmartClickRef {
  @PrimaryColumn()
  id: string;

  @Column()
  customerId: string;

  @Column()
  fbclid: string;

  @CreateDateColumn()
  createdAt: Date;
}
