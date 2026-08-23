import { Module } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Course, CourseSchema } from 'src/courses/schemas/course.entity';

@Module({
  imports: [MongooseModule.forFeature([
        {
          name: Course.name,
          schema: CourseSchema,
        },
      ]),],
  controllers: [ModulesController],
  providers: [ModulesService],
})
export class ModulesModule {}
