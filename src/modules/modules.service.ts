import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Course, CourseDocument, ModuleStatus } from 'src/courses/schemas/course.entity';
import { Model } from 'mongoose';

@Injectable()
export class ModulesService {
  constructor(
      @InjectModel(Course.name)
      private readonly courseModel: Model<CourseDocument>,
    ) {}
  
  async updateModule(courseId: string, moduleId: string, dto: UpdateModuleDto,
  ) {
    const course = await this.courseModel.findById(courseId);

    if (!course) {
      throw new NotFoundException('Course not found',);
    }

    const module =
      course.modules.find((item) => item._id?.toString() === moduleId,);

    if (!module) {
      throw new NotFoundException('Module not found',);
    }

    if (dto.title !== undefined) {
      module.title = dto.title.trim();
    }

    if (dto.summary !== undefined) {
      module.summary = dto.summary;
    }

    if (dto.examples !== undefined) {
      module.examples = dto.examples;
    }

    if (dto.knowledgeChecks !== undefined) {
      module.knowledgeChecks = dto.knowledgeChecks;
    }

    await course.save();

    return {
      success: true,
      message: 'Module updated successfully',
      module,
    };
  }

  async approveModule(courseId: string,moduleId: string,) {
    const course = await this.courseModel.findById(courseId);

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const module =course.modules.find(
        (item) =>
          item._id?.toString() === moduleId,
      );

    if (!module) {
      throw new NotFoundException('Module not found');
    }

    // if (module.status === ModuleStatus.APPROVED) {
    //   return {
    //     success: true,
    //     message: 'Module is already approved',
    //     module,
    //   };
    // }

    module.status = ModuleStatus.APPROVED;

    await course.save();

    return {
      success: true,
      message: 'Module approved successfully',
      module,
    };
  }

  remove(id: string) {
    return `This action removes a #${id} module`;
  }
}
