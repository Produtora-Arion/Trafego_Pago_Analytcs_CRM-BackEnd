import { IsArray, IsBoolean, IsHexColor, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCrmStageDto {
  /** Ignorado pra role 'client' (o controller sempre força o próprio customerId); obrigatório só pra admin. */
  @IsOptional() @IsString() customerId?: string;
  @IsString() @MaxLength(60) label: string;
  @IsHexColor() color: string;
  @IsOptional() @IsBoolean() triggersConversion?: boolean;
  @IsOptional() @IsBoolean() isEntryStage?: boolean;
}

export class UpdateCrmStageDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() triggersConversion?: boolean;
  @IsOptional() @IsBoolean() isEntryStage?: boolean;
}

export class ReorderCrmStagesDto {
  @IsOptional() @IsString() customerId?: string;
  @IsArray() @IsInt({ each: true }) orderedIds: number[];
}
