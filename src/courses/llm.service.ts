import { Injectable, InternalServerErrorException } from '@nestjs/common';

interface GeneratedModule {
  order: number;
  title: string;
  summary: string;
  examples: string[];
  knowledgeChecks: KnowledgeCheck[];
}

interface GeneratedCourseContent {
  learningObjectives: string[];
  modules: GeneratedModule[];
}

interface KnowledgeCheck {
  question: string;
  options: string[];
  answer: string;
}

const CHUNK_THRESHOLD_CHARS = 5500;
const CHUNK_SIZE_CHARS = 5500;
const OLLAMA_TIMEOUT_MS = 900_000;
const OLLAMA_NUM_PREDICT = 2500;

// Baseline tone applied regardless of audience level — depth and precision
// are never sacrificed, only how much prior knowledge is assumed changes.
const PROFESSIONAL_TONE_INSTRUCTION = `Write for a working professional who is genuinely learning this subject, not a child. Use accurate, correct domain terminology rather than avoiding it. Prioritize real depth over brevity: explain not just WHAT a concept is, but WHY it matters and HOW it is actually applied in practice. Avoid vague, generic filler sentences — every sentence should teach something specific and concrete. Do not write a thin, superficial summary.`;

// NEW — this is the piece that was missing. targetAudience was previously
// passed into the prompt as a bare label with no instruction attached to
// it, so the model had nothing to actually act on. This maps each level to
// a concrete instruction about assumed background and depth.
function getAudienceInstruction(targetAudience: string): string {
  const normalized = (targetAudience || '').toUpperCase();

  switch (normalized) {
    case 'BEGINNER':
      return `AUDIENCE LEVEL: Beginner. Assume the learner has NO prior background in this subject. Define every foundational term clearly the first time it appears — do not assume familiarity with related tools, jargon, or concepts outside what's explicitly in the source material. Build ideas up from first principles before introducing any advanced implications. Prefer simpler sentence structure over dense, jargon-heavy phrasing, while still using correct terminology.`;
    case 'ADVANCED':
      return `AUDIENCE LEVEL: Advanced. Assume the learner already has strong, working foundational knowledge in this domain — do NOT define basic terms or re-explain fundamentals. Focus on nuance, trade-offs, edge cases, and practical implications an experienced practitioner would actually care about. It's acceptable, even expected, to reference adjacent concepts and tools without stopping to define them.`;
    case 'INTERMEDIATE':
    default:
      return `AUDIENCE LEVEL: Intermediate. Assume the learner has general familiarity with this broader subject area, but not necessarily with these specific concepts. Skip defining very basic foundational terms, but clearly explain how each concept connects to or builds on typical prior knowledge in this field.`;
  }
}

@Injectable()
export class LlmService {
  private readonly baseUrl =
    process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  private readonly model = process.env.OLLAMA_MODEL || 'llama3';

  async generateModules(
    extractedText: string,
    courseTitle: string,
    targetAudience: string,
  ): Promise<GeneratedCourseContent> {
    const trimmedInput = extractedText.trim();

    if (trimmedInput.length <= CHUNK_THRESHOLD_CHARS) {
      return this.generateFromSingleChunk(
        trimmedInput,
        courseTitle,
        targetAudience,
      );
    }

    const chunks = this.splitIntoChunks(trimmedInput, CHUNK_SIZE_CHARS);

    const learningObjectives = await this.generateObjectives(
      chunks[0],
      courseTitle,
      targetAudience,
    );

    const modulesPerChunk: GeneratedModule[][] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkModules = await this.generateModulesForChunk(
        chunks[i],
        courseTitle,
        targetAudience,
        i + 1,
        chunks.length,
      );
      modulesPerChunk.push(chunkModules);
    }

    const mergedModules = modulesPerChunk
      .flat()
      .map((module, index) => ({ ...module, order: index + 1 }));

    if (mergedModules.length === 0) {
      throw new InternalServerErrorException(
        'Ollama produced no modules across any chunk of the source document.',
      );
    }

    return { learningObjectives, modules: mergedModules };
  }

  // ============================================================
  // SPLIT
  // ============================================================

  private splitIntoChunks(text: string, maxChars: number): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
      if (current.length + paragraph.length > maxChars && current.length > 0) {
        chunks.push(current.trim());
        current = '';
      }
      current += paragraph + '\n\n';
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.flatMap((chunk) =>
      chunk.length > maxChars * 1.5
        ? [chunk.slice(0, maxChars), chunk.slice(maxChars)]
        : [chunk],
    );
  }

  // ============================================================
  // GENERATE — single-call path
  // ============================================================

  private async generateFromSingleChunk(
    text: string,
    courseTitle: string,
    targetAudience: string,
  ): Promise<GeneratedCourseContent> {
    const prompt = `You are a senior instructional designer building professional training content, similar in depth to enterprise product documentation.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Source material:
"""${text}"""

${PROFESSIONAL_TONE_INSTRUCTION}

${getAudienceInstruction(targetAudience)}

Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{
  "learningObjectives": ["string", "string", "string", "string"],
  "modules": [
    {
      "order": 1,
      "title": "string",
      "summary": "A thorough 4 to 6 sentence explanation of the concept, calibrated to the audience level above — not a one-line summary.",
      "examples": ["a concrete, realistic example grounded in actual professional use", "a second distinct concrete example"],
      "knowledgeChecks": [
        { "question": "string", "options": ["string", "string", "string", "string"], "answer": "string, must exactly match one of the options" }
      ]
    }
  ]
}

Create exactly 4 to 6 course-wide learningObjectives, exactly 3 modules covering genuinely distinct sub-topics from the source material, 2 to 3 concrete examples per module, and exactly 2 knowledgeChecks per module, each with 4 answer options.`;

    const raw = await this.callOllama(prompt);
    return this.parseFullResponse(raw);
  }

  // ============================================================
  // GENERATE — chunked path
  // ============================================================

  private async generateModulesForChunk(
    chunkText: string,
    courseTitle: string,
    targetAudience: string,
    chunkIndex: number,
    totalChunks: number,
  ): Promise<GeneratedModule[]> {
    const prompt = `You are a senior instructional designer building professional training content, similar in depth to enterprise product documentation. This is section ${chunkIndex} of ${totalChunks} of a larger source document for a course.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Section text:
"""${chunkText}"""

${PROFESSIONAL_TONE_INSTRUCTION}

${getAudienceInstruction(targetAudience)}

Turn ONLY this section into 1 course module covering just this section's content, in real depth, calibrated to the audience level above.
Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{
  "modules": [
    {
      "order": 1,
      "title": "string",
      "summary": "A thorough 4 to 6 sentence explanation of the concept, calibrated to the audience level above.",
      "examples": ["a concrete, realistic example grounded in actual professional use", "a second distinct concrete example"],
      "knowledgeChecks": [
        { "question": "string", "options": ["string", "string", "string", "string"], "answer": "string, must exactly match one of the options" }
      ]
    }
  ]
}

Provide 2 to 3 concrete examples and exactly 2 knowledgeChecks for this module, each with 4 answer options.`;

    const raw = await this.callOllama(prompt);
    return this.parseModulesOnly(raw);
  }

  // ============================================================
  // GENERATE — regenerate a single existing module
  // ============================================================

  async regenerateModule(
    sourceText: string,
    courseTitle: string,
    targetAudience: string,
    currentModuleTitle: string,
  ): Promise<Omit<GeneratedModule, 'order'>> {
    const trimmedInput = sourceText.trim().slice(0, CHUNK_THRESHOLD_CHARS);

    const prompt = `You are a senior instructional designer. Re-research and rewrite ONE module of an existing training course using the source material below. Produce fresh, deeper content — do not just repeat the module's current wording.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Module topic to cover: "${currentModuleTitle}"
Source material:
"""${trimmedInput}"""

${PROFESSIONAL_TONE_INSTRUCTION}

${getAudienceInstruction(targetAudience)}

Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{
  "title": "string",
  "summary": "A thorough 4 to 6 sentence explanation, calibrated to the audience level above.",
  "examples": ["a concrete, realistic example", "a second distinct concrete example"],
  "knowledgeChecks": [
    { "question": "string", "options": ["string", "string", "string", "string"], "answer": "string, must exactly match one of the options" }
  ]
}

Provide 2 to 3 examples and exactly 2 knowledgeChecks, each with 4 answer options.`;

    const raw = await this.callOllama(prompt);
    return this.parseSingleModule(raw);
  }

  private async generateObjectives(
    firstChunk: string,
    courseTitle: string,
    targetAudience: string,
  ): Promise<string[]> {
    const prompt = `You are a senior instructional designer. Based on this opening section of a larger source document, write course-wide learning objectives.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Opening section:
"""${firstChunk}"""

${getAudienceInstruction(targetAudience)}

Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{ "learningObjectives": ["string", "string", "string", "string"] }

Write 4 to 6 specific, concrete objectives describing what a learner will actually be able to DO after the FULL course, calibrated to the audience level above — avoid vague phrasing like "understand the basics of X"; prefer specific, actionable outcomes.`;

    const raw = await this.callOllama(prompt);

    try {
      const cleaned = this.stripFences(raw);
      const parsed = JSON.parse(cleaned) as { learningObjectives?: string[] };
      return Array.isArray(parsed.learningObjectives)
        ? parsed.learningObjectives
        : [];
    } catch {
      return [];
    }
  }

  // ============================================================
  // Shared Ollama call
  // ============================================================

  private async callOllama(prompt: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          keep_alive: '30m',
          options: {
            temperature: 0.3,
            num_ctx: 8192,
            num_predict: OLLAMA_NUM_PREDICT,
          },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new InternalServerErrorException(
          `Ollama did not finish within ${OLLAMA_TIMEOUT_MS / 1000} seconds. Try a shorter source, or retry after the current local model request finishes.`,
        );
      }

      throw new InternalServerErrorException(
        `Could not reach Ollama at ${this.baseUrl}. Is 'ollama serve' running?`,
      );
    }

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Ollama returned an error: ${response.status}`,
      );
    }

    const data = (await response.json()) as { response?: string };
    if (!data?.response) {
      throw new InternalServerErrorException(
        'Ollama returned an empty response',
      );
    }

    return data.response;
  }

  // ============================================================
  // Parsing helpers
  // ============================================================

  private stripFences(rawText: string): string {
    return rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '');
  }

  private parseFullResponse(rawText: string): GeneratedCourseContent {
    let parsed: Partial<GeneratedCourseContent>;
    try {
      parsed = JSON.parse(
        this.stripFences(rawText),
      ) as Partial<GeneratedCourseContent>;
    } catch {
      throw new InternalServerErrorException(
        'Ollama returned malformed JSON. Try again — llama3 occasionally produces invalid output.',
      );
    }

    if (
      !parsed.modules ||
      !Array.isArray(parsed.modules) ||
      parsed.modules.length === 0
    ) {
      throw new InternalServerErrorException(
        'Ollama response had no modules array',
      );
    }

    return {
      learningObjectives: Array.isArray(parsed.learningObjectives)
        ? parsed.learningObjectives
        : [],
      modules: this.normalizeModules(parsed.modules),
    };
  }

  private parseModulesOnly(rawText: string): GeneratedModule[] {
    let parsed: { modules?: GeneratedModule[] };
    try {
      parsed = JSON.parse(this.stripFences(rawText)) as {
        modules?: GeneratedModule[];
      };
    } catch {
      throw new InternalServerErrorException(
        'Ollama returned malformed JSON for one chunk. Try again — llama3 occasionally produces invalid output.',
      );
    }

    return Array.isArray(parsed.modules)
      ? this.normalizeModules(parsed.modules)
      : [];
  }

  private parseSingleModule(rawText: string): Omit<GeneratedModule, 'order'> {
    let parsed: Partial<Omit<GeneratedModule, 'order'>>;
    try {
      parsed = JSON.parse(this.stripFences(rawText)) as Partial<
        Omit<GeneratedModule, 'order'>
      >;
    } catch {
      throw new InternalServerErrorException(
        'Ollama returned malformed JSON while regenerating this module. Try again — llama3 occasionally produces invalid output.',
      );
    }

    if (!parsed.title || !parsed.summary) {
      throw new InternalServerErrorException(
        'Ollama response was missing a title or summary for the regenerated module',
      );
    }

    return {
      title: parsed.title,
      summary: parsed.summary,
      examples: Array.isArray(parsed.examples) ? parsed.examples : [],
      knowledgeChecks: this.normalizeKnowledgeChecks(
        parsed.knowledgeChecks,
        this.getAnswerPool(parsed.knowledgeChecks),
      ),
    };
  }

  private normalizeModules(modules: GeneratedModule[]): GeneratedModule[] {
    const answerPool = modules.flatMap((module) =>
      this.getAnswerPool(module.knowledgeChecks),
    );

    return modules.map((module, index) =>
      this.normalizeModule(module, index, answerPool),
    );
  }

  private normalizeModule(
    module: Partial<GeneratedModule>,
    index: number,
    answerPool: string[],
  ): GeneratedModule {
    return {
      order: module.order ?? index + 1,
      title: module.title || `Module ${index + 1}`,
      summary: module.summary || '',
      examples: Array.isArray(module.examples) ? module.examples : [],
      knowledgeChecks: this.normalizeKnowledgeChecks(
        module.knowledgeChecks,
        answerPool,
      ),
    };
  }

  private normalizeKnowledgeChecks(
    value: unknown,
    answerPool: string[] = [],
  ): KnowledgeCheck[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const candidate = item as Partial<KnowledgeCheck>;
        const question = this.cleanText(candidate.question);
        const answer = this.cleanText(candidate.answer);
        const options = Array.isArray(candidate.options)
          ? candidate.options.map((option) => this.cleanText(option))
          : [];
        const fallbackOptions = answerPool.filter(
          (option) => option !== answer,
        );
        const uniqueOptions = [
          ...new Set([answer, ...options, ...fallbackOptions].filter(Boolean)),
        ];

        if (!question || !answer) {
          return null;
        }

        return {
          question,
          options: uniqueOptions.slice(0, 4),
          answer,
        };
      })
      .filter((item): item is KnowledgeCheck => item !== null);
  }

  private getAnswerPool(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((item) =>
            item && typeof item === 'object'
              ? this.cleanText((item as Partial<KnowledgeCheck>).answer)
              : '',
          )
          .filter(Boolean),
      ),
    ];
  }

  private cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}