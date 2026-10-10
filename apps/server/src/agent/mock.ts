import type { PageHit } from './source';
import type { ToolRunner } from './tools';
import type { Agent, AgentEvent, AnswerDraft, ChatRequest, DraftCitation } from './types';

export interface MockAgentOptions {
  /** Pause between streamed text deltas, so the UI visibly streams. 0 in tests. */
  delayMs?: number;
  /** Test hook: citations appended to every answer after the real ones (to exercise validation). */
  extraCitations?: DraftCitation[];
}

/** First sentence of a chunk, verbatim, so quoting it always passes the quote check. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = flat.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : flat).trim();
}

/** About four characters per token. Good enough for a demo counter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deterministic stand-in for the real study agent. It follows the same loop the real one will
 * (search tool -> draft answer with citations) but uses fixed rules, so the same question always
 * produces the same cited answer and the demo needs no API key.
 */
export class MockAgent implements Agent {
  readonly id = 'mock';

  constructor(private readonly options: MockAgentOptions = {}) {}

  async *run(req: ChatRequest, tools: ToolRunner): AsyncGenerator<AgentEvent> {
    const delay = this.options.delayMs ?? 0;

    const call = tools.search(req.message);
    yield call.started;
    if (delay) await sleep(delay * 4);
    const { finished, hits } = await call.finish();
    yield finished;

    const inputTokens =
      estimateTokens(req.message) + hits.reduce((n, h) => n + estimateTokens(h.text), 0);
    yield { type: 'usage', inputTokens, outputTokens: 0 };

    const draft = this.compose(hits);
    for (const delta of toDeltas(draft.text)) {
      yield { type: 'text', delta };
      if (delay) await sleep(delay);
    }
    yield { type: 'usage', inputTokens, outputTokens: estimateTokens(draft.text) };
    yield { type: 'draft', draft };
  }

  private compose(hits: PageHit[]): AnswerDraft {
    if (hits.length === 0) {
      return {
        text: "I couldn't find anything about that in your course material.",
        citations: [],
        abstained: true,
      };
    }
    const used = hits.slice(0, 3);
    const citations: DraftCitation[] = used.map((h) => ({
      documentId: h.documentId,
      chunkId: h.chunkId,
      page: h.page,
      printedPage: h.printedPage,
      quote: firstSentence(h.text),
      documentTitle: h.documentTitle,
    }));
    const body = used.map((h, i) => `${firstSentence(h.text)} [${i + 1}]`).join(' ');
    const extra = this.options.extraCitations ?? [];
    const markers = extra.map((_, i) => ` [${used.length + i + 1}]`).join('');
    return {
      text: `From your course material: ${body}${markers}`,
      citations: [...citations, ...extra],
      abstained: false,
    };
  }
}

/** Split into word-sized deltas that rejoin to exactly the original text. */
export function toDeltas(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}
