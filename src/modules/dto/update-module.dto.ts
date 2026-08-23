import {
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateModuleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  examples?: string[];

  @IsOptional()
  @IsArray()
  knowledgeChecks?: Record<string, any>[];
}