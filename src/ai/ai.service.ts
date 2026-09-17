import { Injectable, InternalServerErrorException } from '@nestjs/common';

import OpenAI from 'openai';
import { createReadStream } from 'fs';

@Injectable()
export class AiService {
  private readonly openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async transcribeAudio(filePath: string): Promise<string> {
    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: createReadStream(filePath),
        model: 'whisper-1',
      });

      return transcription.text.trim();
    } catch (error) {
      console.error('Audio transcription failed:', error);

      throw new InternalServerErrorException('Failed to transcribe audio');
    }
  }
}
