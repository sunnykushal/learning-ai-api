import { Injectable, InternalServerErrorException } from '@nestjs/common';

interface GeneratedModule {
  order: number;
  title: string;
  summary: string;
  examples: string[];
  knowledgeChecks: { question: string; answer: string }[];
}

interface GeneratedCourseContent {
  learningObjectives: string[];
  modules: GeneratedModule[];
}

// Above this length, we split the text into chunks instead of sending it all
// in one prompt. Below it, the old single-call path runs unchanged.
const CHUNK_THRESHOLD_CHARS = 7000;
const CHUNK_SIZE_CHARS = 7000;

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
      // Short source — one call, same as before.
      return this.generateFromSingleChunk(
        trimmedInput,
        courseTitle,
        targetAudience,
      );
    }

    // ---------- SPLIT ----------
    const chunks = this.splitIntoChunks(trimmedInput, CHUNK_SIZE_CHARS);

    // ---------- GENERATE ----------
    // Learning objectives are course-wide, not per-chunk — generate them once
    // from the first chunk (the intro/overview is almost always near the start
    // of a document) rather than repeating similar objectives per chunk.
    const objectivesPromise = this.generateObjectives(
      chunks[0],
      courseTitle,
      targetAudience,
    );

    const modulesPerChunk: GeneratedModule[][] = [];
    for (let i = 0; i < chunks.length; i++) {
      // Sequential, not Promise.all — a single local Ollama instance processes
      // one request at a time anyway, and this keeps memory/log output sane.
      const chunkModules = await this.generateModulesForChunk(
        chunks[i],
        courseTitle,
        targetAudience,
        i + 1,
        chunks.length,
      );
      modulesPerChunk.push(chunkModules);
    }

    const learningObjectives = await objectivesPromise;

    // ---------- MERGE ----------
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
    // Split on blank lines (paragraph boundaries) so we don't cut a sentence
    // in half mid-chunk — that produces noticeably worse LLM output.
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

    // Edge case: a single paragraph longer than maxChars with no blank lines
    // at all (e.g. one giant block of text). Hard-slice it as a last resort.
    return chunks.flatMap((chunk) =>
      chunk.length > maxChars * 1.5
        ? [chunk.slice(0, maxChars), chunk.slice(maxChars)]
        : [chunk],
    );
  }

  // ============================================================
  // GENERATE — single-call path (short source, unchanged behavior)
  // ============================================================

  private async generateFromSingleChunk(
    text: string,
    courseTitle: string,
    targetAudience: string,
  ): Promise<GeneratedCourseContent> {
    const prompt = `You are an instructional designer. Turn this source material into a training course.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Source material:
"""${text}"""

Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{
  "learningObjectives": ["string", "string", "string"],
  "modules": [
    {
      "order": 1,
      "title": "string",
      "summary": "2-3 sentence summary",
      "examples": ["concrete example 1", "concrete example 2"],
      "knowledgeChecks": [
        { "question": "string", "answer": "string" }
      ]
    }
  ]
}

Create 4 to 6 course-wide learningObjectives, and 3 to 5 modules depending on how much distinct content is in the source.`;

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
    const prompt = `You are an instructional designer. This is section ${chunkIndex} of ${totalChunks} of a larger source document for a course.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Section text:
"""${chunkText}"""

Turn ONLY this section into 1 to 3 course modules covering just this section's content.
Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{
  "modules": [
    {
      "order": 1,
      "title": "string",
      "summary": "2-3 sentence summary",
      "examples": ["concrete example 1", "concrete example 2"],
      "knowledgeChecks": [
        { "question": "string", "answer": "string" }
      ]
    }
  ]
}`;

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

    const prompt = `You are an instructional designer. Re-research and rewrite ONE module of an existing training course using the source material below. Produce fresh content — do not just repeat the module's current wording.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Module topic to cover: "${currentModuleTitle}"
Source material:
"""${trimmedInput}"""

Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{
  "title": "string",
  "summary": "2-3 sentence summary",
  "examples": ["concrete example 1", "concrete example 2"],
  "knowledgeChecks": [
    { "question": "string", "answer": "string" }
  ]
}`;

    const raw = await this.callOllama(prompt);
    return this.parseSingleModule(raw);
  }

  private async generateObjectives(
    firstChunk: string,
    courseTitle: string,
    targetAudience: string,
  ): Promise<string[]> {
    const prompt = `You are an instructional designer. Based on this opening section of a larger source document, write course-wide learning objectives.
Course title: ${courseTitle}
Target audience: ${targetAudience}
Opening section:
"""${firstChunk}"""

Return ONLY a JSON object in exactly this shape, with no extra text, no markdown fences:
{ "learningObjectives": ["string", "string", "string", "string"] }

Write 4 to 6 objectives that describe what a learner will be able to do after the FULL course, not just this section.`;

    const raw = await this.callOllama(prompt);

    try {
      const cleaned = this.stripFences(raw);
      const parsed = JSON.parse(cleaned) as { learningObjectives?: string[] };
      return Array.isArray(parsed.learningObjectives)
        ? parsed.learningObjectives
        : [];
    } catch {
      // Objectives are non-critical to the course being usable — don't fail
      // the whole generation over this one call.
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.3,
            num_ctx: 8192, // raise from Ollama's small default so a full chunk actually fits
          },
        }),
      });
    } catch {
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
      modules: parsed.modules,
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

    return Array.isArray(parsed.modules) ? parsed.modules : [];
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
      knowledgeChecks: Array.isArray(parsed.knowledgeChecks)
        ? parsed.knowledgeChecks
        : [],
    };
  }
}
