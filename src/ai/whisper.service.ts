import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';

const execFileAsync = promisify(execFile);

@Injectable()
export class WhisperService {
  private readonly executable: string;
  private readonly modelPath: string;
  private readonly language: string;

  constructor(private readonly configService?: ConfigService) {
    this.executable = this.resolveExecutablePath();
    this.modelPath = this.resolveModelPath();
    this.language = this.resolveLanguage();
  }

  async transcribe(audioPath: string): Promise<string> {
    this.validateConfiguration();

    if (!existsSync(audioPath)) {
      throw new InternalServerErrorException(
        'Audio file does not exist',
      );
    }

    const outputBasePath = `${audioPath}.transcript`;

    try {
      await execFileAsync(
        this.executable,
        [
          '-m',
          this.modelPath,
          '-f',
          audioPath,
          '-l',
          this.language,
          '-otxt',
          '-of',
          outputBasePath,
          '-np',
        ],
        {
          windowsHide: true,
          maxBuffer: 20 * 1024 * 1024,
        },
      );

      const transcriptPath = `${outputBasePath}.txt`;
      const transcript =
        this.extractTranscript(
          await readFile(transcriptPath, 'utf-8'),
        );

      if (!transcript) {
        throw new InternalServerErrorException(
          'Whisper returned an empty transcript',
        );
      }

      return transcript;
    } catch (error) {
      console.error('Whisper transcription failed:', error);

      throw new InternalServerErrorException(
        'Failed to transcribe audio',
      );
    } finally {
      await this.cleanup(`${outputBasePath}.txt`);
    }
  }

  resolveExecutablePath(): string {
    const configuredExecutable =
      this.configService?.get<string>('WHISPER_EXECUTABLE') ??
      process.env.WHISPER_EXECUTABLE?.trim();

    if (configuredExecutable) {
      return configuredExecutable;
    }

    return process.platform === 'win32' ? 'whisper.exe' : 'whisper';
  }

  resolveModelPath(): string {
    const configuredModelPath =
      this.configService?.get<string>('WHISPER_MODEL_PATH') ??
      process.env.WHISPER_MODEL_PATH?.trim();

    if (configuredModelPath) {
      return configuredModelPath;
    }

    return 'models/ggml-base.bin';
  }

  resolveLanguage(): string {
    return (
      this.configService?.get<string>('WHISPER_LANGUAGE') ??
      process.env.WHISPER_LANGUAGE?.trim() ??
      'en'
    );
  }

  extractTranscript(output: string): string {
    return output
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\[[^\]]+\]\s*/, '')
          .replace(/^\[[^\]]+\s*->\s*[^\]]+\]\s*/, '')
          .trim(),
      )
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private validateConfiguration(): void {
    if (!existsSync(this.executable)) {
      throw new InternalServerErrorException(
        `Whisper executable not found: ${this.executable}`,
      );
    }

    if (!existsSync(this.modelPath)) {
      throw new InternalServerErrorException(
        `Whisper model not found: ${this.modelPath}`,
      );
    }
  }

  private async cleanup(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // File may not exist. Nothing to clean up.
    }
  }
}