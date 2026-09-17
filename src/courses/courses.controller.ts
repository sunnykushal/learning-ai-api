import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CoursesService } from './courses.service';
import { UpdateCourseDto } from './dto/update-course.dto';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  create(@Req() request: FastifyRequest): Promise<unknown> {
    return this.coursesService.generateCourse(request);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<unknown> {
    return this.coursesService.findById(id);
  }

  @Get()
  findAll(): Promise<unknown> {
    return this.coursesService.findAll();
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCourseDto: UpdateCourseDto,
  ): Promise<unknown> {
    return this.coursesService.update(id, updateCourseDto);
  }

  @Patch(':courseId/approve')
  approveCourse(@Param('courseId') courseId: string): Promise<unknown> {
    return this.coursesService.approveCourse(courseId);
  }
}
