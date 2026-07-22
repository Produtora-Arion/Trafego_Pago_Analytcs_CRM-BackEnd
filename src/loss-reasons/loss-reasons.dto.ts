import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateLossReasonDto {
  /** Ignorado pra role 'client' (o controller sempre força o próprio customerId); obrigatório só pra admin. */
  @IsOptional() @IsString() customerId?: string;
  @IsString() @MaxLength(120) label: string;
}

export class UpdateLossReasonDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
