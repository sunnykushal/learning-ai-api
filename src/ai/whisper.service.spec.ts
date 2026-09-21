import { WhisperService } from './whisper.service';

describe('WhisperService', () => {
  const originalExecutable = process.env.WHISPER_EXECUTABLE;
  const originalModel = process.env.WHISPER_MODEL_PATH;

  afterEach(() => {
    if (originalExecutable === undefined) {
      delete process.env.WHISPER_EXECUTABLE;
    } else {
      process.env.WHISPER_EXECUTABLE = originalExecutable;
    }

    if (originalModel === undefined) {
      delete process.env.WHISPER_MODEL_PATH;
    } else {
      process.env.WHISPER_MODEL_PATH = originalModel;
    }
  });

  it('resolves the local CLI and model path from environment variables', () => {
    process.env.WHISPER_EXECUTABLE = 'C:/whisper/bin/whisper.exe';
    process.env.WHISPER_MODEL_PATH = 'C:/whisper/models/ggml-base.bin';

    const service = new WhisperService();

    expect(service['resolveExecutablePath']()).toBe('C:/whisper/bin/whisper.exe');
    expect(service['resolveModelPath']()).toBe('C:/whisper/models/ggml-base.bin');
  });

  it('strips timestamp prefixes and joins transcript lines cleanly', () => {
    const service = new WhisperService();
    const output = `
[00:00.000 -> 00:03.000] Hello there.
[00:03.000 -> 00:06.000] This is a test.
`;

    expect(service['extractTranscript'](output)).toBe(
      'Hello there. This is a test.',
    );
  });
});
