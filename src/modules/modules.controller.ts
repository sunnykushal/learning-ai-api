import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';

@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Patch('/courses/:courseId/modules/:moduleId')
  update(
    @Param('courseId') courseId: string,
    @Param('moduleId') moduleId: string,
    @Body() updateModuleDto: UpdateModuleDto
  ) {
    return this.modulesService.updateModule(courseId, moduleId, updateModuleDto);
  }

  @Patch(':courseId/modules/:moduleId/approve')
  async approveModule(
    @Param('courseId') courseId: string,
    @Param('moduleId') moduleId: string,
  ) {
    return this.modulesService.approveModule(courseId,moduleId,);
  }

  @Delete('/courses/:courseId/modules/:moduleId')
  remove(
    @Param('moduleId') moduleId: string
  ) {
    return this.modulesService.remove(moduleId);
  }
}
