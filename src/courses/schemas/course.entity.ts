import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SourceType, TargetAudience } from '../dto/create-course.dto';

export type CourseDocument = HydratedDocument<Course>;

export enum CourseStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  APPROVED = 'APPROVED',
  FAILED = 'FAILED',
}

@Schema({ _id: false })
export class Source {
  @Prop({
    required: true,
    enum: SourceType,
  })
  type: SourceType;

  @Prop()
  fileName?: string;

  @Prop()
  filePath?: string;

  @Prop()
  extractedText?: string;
}

@Schema({ _id: false })
export class Module {
  @Prop({ required: true })
  order: number;

  @Prop({ required: true })
  title: string;

  // @Prop({ type: [String], default: [] })
  // learningObjectives: string[];

  @Prop()
  summary?: string;

  @Prop({ type: [String], default: [] })
  examples: string[];

  @Prop({ type: [Object], default: [] })
  knowledgeChecks: Record<string, any>[];
}

@Schema({ timestamps: true })
export class Course {
  @Prop({ required: true, unique: true, trim: true })
  courseTitle: string;

  @Prop({
    required: true,
    enum: TargetAudience,
  })
  targetAudience: TargetAudience;

  @Prop({
    required: true,
    enum: CourseStatus,
    default: CourseStatus.DRAFT,
  })
  status: CourseStatus;

  @Prop({
    required: true,
    type: Source,
  })
  source: Source;

  @Prop({ type: [String], default: [] })
  learningObjectives: string[];

  @Prop({
    type: [Module],
    default: [],
  })
  modules: Module[];
}

export const CourseSchema = SchemaFactory.createForClass(Course);