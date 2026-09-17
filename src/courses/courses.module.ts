import { Module } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Course, CourseSchema } from './schemas/course.entity';
import { AiModule } from 'src/ai/ai.module';
import { LlmService } from './llm.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Course.name,
        schema: CourseSchema,
      },
    ]),
    AiModule,
  ],
  controllers: [CoursesController],
  providers: [CoursesService, LlmService],
})
export class CoursesModule {}
