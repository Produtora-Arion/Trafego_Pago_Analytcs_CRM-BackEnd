import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateTrackedUrlDto {
  @IsString() @MaxLength(80) name: string;
  @IsUrl({ require_tld: false }) @MaxLength(500) url: string;
}

export class UpdateTrackedUrlDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(500) url?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
