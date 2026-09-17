import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum TargetAudience {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
}

export enum SourceType {
  PDF = 'PDF',
  AUDIO = 'AUDIO',
  TEXT = 'TEXT',
}

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  courseTitle: string;

  @IsEnum(TargetAudience)
  targetAudience!: TargetAudience;

  @IsEnum(SourceType)
  sourceType!: SourceType;

  // Required only when sourceType = TEXT
  @IsOptional()
  @IsString()
  content?: string;
}
