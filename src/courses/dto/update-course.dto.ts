import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  courseTitle?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  learningObjectives?: string[];
}