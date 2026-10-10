import type { ChatEvent } from './types';
import type { ChunkSource, PageHit } from './source';

export const SEARCH_TOOL = 'search_course';

export class ToolLimitError extends Error {
  constructor(limit: number) {
    super(`The agent tried to call more than ${limit} tools in one answer.`);
    this.name = 'ToolLimitError';
  }
}

/** "41, 42, 43, 45" -> "41-43, 45". */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

/** The line shown in the chat for a finished lookup, for example "Looked up pages 41-48". */
export function summarizeLookup(hits: PageHit[]): string {
  if (hits.length === 0) return 'Searched your course material and found nothing relevant';
  const pages = hits.map((h) => h.printedPage);
  const label = new Set(pages).size === 1 ? 'page' : 'pages';
  return `Looked up ${label} ${formatPageRanges(pages)}`;
}

type StartedEvent = Extract<ChatEvent, { type: 'tool-started' }>;
type FinishedEvent = Extract<ChatEvent, { type: 'tool-finished' }>;

export interface ToolCall {
  started: StartedEvent;
  /** Runs the lookup. Await it after emitting `started`. */
  finish(): Promise<{ finished: FinishedEvent; hits: PageHit[] }>;
}

/**
 * The only way an agent can read course material. Every chunk it returns is recorded, and that
 * record is what the answer-validate step checks citations against: a citation to anything not
 * in here was never retrieved.
 */
export class ToolRunner {
  private readonly returnedById = new Map<string, PageHit>();
  private calls = 0;

  constructor(
    private readonly source: ChunkSource,
    private readonly courseId: string,
    private readonly maxCalls = 8,
    private readonly topK = 4,
  ) {}

  /** Everything any tool returned during this answer. */
  get returned(): PageHit[] {
    return [...this.returnedById.values()];
  }

  search(query: string): ToolCall {
    if (this.calls >= this.maxCalls) throw new ToolLimitError(this.maxCalls);
    this.calls += 1;
    const id = `tool-${this.calls}`;
    const started: StartedEvent = { type: 'tool-started', id, name: SEARCH_TOOL, input: { query } };
    return {
      started,
      finish: async () => {
        const hits = await this.source.search(this.courseId, query, this.topK);
        for (const hit of hits) this.returnedById.set(hit.chunkId, hit);
        const finished: FinishedEvent = {
          type: 'tool-finished',
          id,
          name: SEARCH_TOOL,
          summary: summarizeLookup(hits),
          pages: [...new Set(hits.map((h) => h.printedPage))].sort((a, b) => a - b),
          resultCount: hits.length,
        };
        return { finished, hits };
      },
    };
  }
}
