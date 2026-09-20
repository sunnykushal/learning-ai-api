import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { WhisperService } from './whisper.service';

@Module({
  controllers: [AiController],
  providers: [AiService, WhisperService],
  exports: [AiService],
})
export class AiModule {}
