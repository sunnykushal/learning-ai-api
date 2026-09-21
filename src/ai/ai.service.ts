import { BadRequestException, Injectable } from '@nestjs/common';
import { WhisperService } from './whisper.service';

@Injectable()
export class AiService {
  constructor(
    private readonly whisperService: WhisperService,
  ) {}

  async transcribeAudio(
    filePath: string,
  ): Promise<string> {
    const text =
      await this.whisperService.transcribe(
        filePath,
      );

    if (!text) {
      throw new BadRequestException(
        'No readable speech found in audio',
      );
    }

    return text;
  }
}