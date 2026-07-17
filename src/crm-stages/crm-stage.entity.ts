import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_stages')
export class CrmStage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerId: string;

  @Column()
  label: string;

  @Column({ default: '#6b7280' })
  color: string;

  @Column({ default: 0 })
  position: number;

  @Column({ default: false })
  triggersConversion: boolean;
}
