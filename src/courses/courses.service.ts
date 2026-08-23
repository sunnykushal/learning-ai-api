import { BadRequestException, Injectable, NotFoundException, } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FastifyRequest } from 'fastify';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import pdfParse from 'pdf-parse';

import { Course, CourseDocument, CourseStatus, ModuleStatus,} from './schemas/course.entity';

import { SourceType, TargetAudience, } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

interface ParsedCourseRequest {
  courseTitle: string;
  targetAudience: TargetAudience;
  sourceType: SourceType;
  content?: string;

  file?: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  };
}

interface ProcessedSource {
  type: SourceType;
  fileName?: string;
  filePath?: string;
  extractedText: string;
}

@Injectable()
export class CoursesService {
  constructor(
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
  ) {}

  async generateCourse(request: FastifyRequest) {
    const courseRequest =
      await this.parseMultipartRequest(request);

    await this.validateCourseTitle(
      courseRequest.courseTitle,
    );

    this.validateCourseRequest(courseRequest);

    const processedSource =
      await this.processSource(courseRequest);

    const course =
      await this.createCourse(
        courseRequest,
        processedSource,
      );

    return this.buildCreateCourseResponse(course);
  }

  // ============================================================
  // REQUEST PARSING
  // ============================================================

  private async parseMultipartRequest(
    request: FastifyRequest,
  ): Promise<ParsedCourseRequest> {
    let courseTitle: string | undefined;
    let targetAudience: TargetAudience | undefined;
    let sourceType: SourceType | undefined;
    let content: string | undefined;

    let file: ParsedCourseRequest['file'];

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        switch (part.fieldname) {
          case 'courseTitle':
            courseTitle = String(part.value);
            break;

          case 'targetAudience':
            targetAudience =
              String(part.value) as TargetAudience;
            break;

          case 'sourceType':
            sourceType =
              String(part.value) as SourceType;
            break;

          case 'content':
            content = String(part.value);
            break;
        }

        continue;
      }

      if (part.type === 'file') {
        file = {
          buffer: await part.toBuffer(),
          fileName: part.filename,
          mimeType: part.mimetype,
        };
      }
    }

    if (!courseTitle || !targetAudience || !sourceType) {
      throw new BadRequestException(
        'Course title, target audience and source type are required',
      );
    }

    return {
      courseTitle,
      targetAudience,
      sourceType,
      content,
      file,
    };
  }

  // ============================================================
  // VALIDATION
  // ============================================================

  private validateCourseRequest(
    request: ParsedCourseRequest,
  ): void {
    const {
      sourceType,
      content,
      file,
    } = request;

    if (sourceType === SourceType.TEXT) {
      this.validateTextSource(content);
      return;
    }

    if (
      sourceType === SourceType.PDF ||
      sourceType === SourceType.AUDIO
    ) {
      this.validateFileSource(file);
      return;
    }

    throw new BadRequestException(
      `Unsupported source type: ${sourceType}`,
    );
  }

  private validateTextSource(
    content?: string,
  ): void {
    if (!content?.trim()) {
      throw new BadRequestException(
        'Content is required for TEXT source',
      );
    }
  }

  private validateFileSource(
    file?: ParsedCourseRequest['file'],
  ): void {
    if (!file) {
      throw new BadRequestException(
        'File is required for this source type',
      );
    }
  }

  // ============================================================
  // SOURCE PROCESSING
  // ============================================================

  private async processSource(
    request: ParsedCourseRequest,
  ): Promise<ProcessedSource> {
    switch (request.sourceType) {
      case SourceType.TEXT:
        return this.processTextSource(request);

      case SourceType.PDF:
        return this.processPdfSource(request);

      case SourceType.AUDIO:
        return this.processAudioSource(request);

      default:
        throw new BadRequestException(
          'Unsupported source type',
        );
    }
  }

  // ============================================================
  // TEXT
  // ============================================================

  private processTextSource(
    request: ParsedCourseRequest,
  ): ProcessedSource {
    return {
      type: SourceType.TEXT,
      extractedText: request.content!.trim(),
    };
  }

  // ============================================================
  // PDF
  // ============================================================

  private async processPdfSource(
    request: ParsedCourseRequest,
  ): Promise<ProcessedSource> {
    const file = request.file!;

    this.validatePdfFile(file);

    const filePath =
      await this.saveUploadedFile(file);

    const extractedText =
      await this.parsePdf(filePath);

    return {
      type: SourceType.PDF,
      fileName: file.fileName,
      filePath,
      extractedText,
    };
  }

  private validatePdfFile(
    file: NonNullable<ParsedCourseRequest['file']>,
  ): void {
    if (file.mimeType !== 'application/pdf') {
      throw new BadRequestException(
        'Only PDF files are supported',
      );
    }
  }

  // ============================================================
  // AUDIO
  // ============================================================

  private async processAudioSource(
    request: ParsedCourseRequest,
  ): Promise<ProcessedSource> {
    const file = request.file!;

    this.validateAudioFile(file);

    const filePath =
      await this.saveUploadedFile(file);

    /*
     * TODO:
     *
     * Send the audio file to a
     * Speech-to-Text model.
     *
     * Example:
     *
     * const extractedText =
     *   await this.transcribeAudio(filePath);
     */

    throw new BadRequestException(
      'Audio transcription is not implemented yet',
    );
  }

  private validateAudioFile(
    file: NonNullable<ParsedCourseRequest['file']>,
  ): void {
    const allowedAudioTypes = [
      'audio/mpeg',
      'audio/wav',
      'audio/mp3',
      'audio/x-wav',
    ];

    if (!allowedAudioTypes.includes(file.mimeType)) {
      throw new BadRequestException(
        'Unsupported audio format',
      );
    }
  }

  // ============================================================
  // FILE STORAGE
  // ============================================================

  private async saveUploadedFile(
    file: NonNullable<ParsedCourseRequest['file']>,
  ): Promise<string> {
    const uploadDirectory =
      join(process.cwd(), 'uploads');

    await mkdir(uploadDirectory, {
      recursive: true,
    });

    const uniqueFileName =
      this.createUniqueFileName(
        file.fileName,
      );

    const filePath =
      join(
        uploadDirectory,
        uniqueFileName,
      );

    await writeFile(
      filePath,
      file.buffer,
    );

    return filePath;
  }

  private createUniqueFileName(
    originalFileName: string,
  ): string {
    const timestamp = Date.now();

    const randomPart =
      Math.random()
        .toString(36)
        .substring(2, 8);

    return `${timestamp}-${randomPart}-${originalFileName}`;
  }

  // ============================================================
  // PDF PARSING
  // ============================================================

  private async parsePdf(
    filePath: string,
  ): Promise<string> {

    const buffer =
      await readFile(filePath);

    const result =
      await pdfParse(buffer);

    if (!result.text?.trim()) {
      throw new BadRequestException(
        'No readable text found in PDF',
      );
    }

    return result.text.trim();
  }

  // ============================================================
  // DATABASE
  // ============================================================

  private async createCourse(
    request: ParsedCourseRequest,
    source: ProcessedSource,
  ): Promise<CourseDocument> {
    return this.courseModel.create({
      courseTitle: request.courseTitle,

      targetAudience:
        request.targetAudience,

      status:
        CourseStatus.PROCESSING,

      source: {
        type: source.type,
        fileName: source.fileName,
        filePath: source.filePath,
        extractedText:
          source.extractedText,
      },

      modules: [],
    });
  }

  // ============================================================
  // RESPONSE
  // ============================================================

  private buildCreateCourseResponse(
    course: CourseDocument,
  ) {
    return {
      success: true,

      message:
        'Course source processed successfully',

      courseId: course._id,

      courseTitle:
        course.courseTitle,

      status:
        course.status,

      sourceType:
        course.source.type,

      fileName:
        course.source.fileName,

      extractedTextLength:
        course.source.extractedText?.length ?? 0,
    };
  }

  private async validateCourseTitle(
    courseTitle: string,
  ): Promise<void> {
    const existingCourse =
      await this.courseModel.exists({
        courseTitle,
      });

    if (existingCourse) {
      throw new BadRequestException(
        `Course with title "${courseTitle}" already exists`,
      );
    }
  }

  async findById(id: string) {
    const course = await this.courseModel.findById(id, {source: 0}).exec();
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return course;
  }

  async findAll() {
    const courses = await this.courseModel.find({}, {source: 0}).exec();
    return courses;
  }

  async update(courseId: string, dto: UpdateCourseDto) {
    const course = await this.courseModel.findById(courseId, {source: 0}).exec();

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (dto.courseTitle !== undefined) {
      const NewTitle = dto.courseTitle.trim();

      if (NewTitle !== course.courseTitle) {
        const duplicate = await this.courseModel.exists({
          courseTitle: NewTitle,
          _id: { $ne: courseId },
        });

        if (duplicate) {
          throw new BadRequestException(`Course with title "${NewTitle}" already exists`);
        }
      }

      course.courseTitle = NewTitle;
    }

    if (dto.learningObjectives !== undefined) {
      course.learningObjectives = dto.learningObjectives;
    }

    try {
      await course.save();

      return {
        success: true,
        message: 'Course updated successfully',
        course,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException('A course with this title already exists');
      }

      throw error;
    }
  }

  async approveCourse(courseId: string) {
    const course = await this.courseModel.findById(courseId, {source: 0}).exec();

    if (!course) {
      throw new NotFoundException('Course not found',);
    }

    if (!course.modules.length) {
      throw new BadRequestException('Course has no modules',);
    }

    const hasUnapprovedModule =
      course.modules.some((module) =>module.status !== ModuleStatus.APPROVED,);

    if (hasUnapprovedModule) {
      throw new BadRequestException('All modules must be approved before publishing the course');
    }

    course.status = CourseStatus.APPROVED;

    await course.save();

    return {
      success: true,
      message: 'Course approved and published successfully',
      course,
    };
  }
}