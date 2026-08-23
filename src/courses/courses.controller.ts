import { Controller, Get, Post, Body, Patch, Param, Delete, Req } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import type{ FastifyRequest } from 'fastify';
import { UpdateCourseDto } from './dto/update-course.dto';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  create(@Req() request:FastifyRequest) {
    return this.coursesService.generateCourse(request);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.coursesService.findById(id);
  }

  @Get()
  findAll() {
    return this.coursesService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCourseDto: UpdateCourseDto) {
    return this.coursesService.update(id, updateCourseDto);
  }

  @Patch(':courseId/approve')
  async approveCourse(
    @Param('courseId') courseId: string,
  ) {
    return this.coursesService.approveCourse(courseId,);
  }
  
}
