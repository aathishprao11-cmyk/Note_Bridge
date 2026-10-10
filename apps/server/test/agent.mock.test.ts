import { describe, expect, it } from 'vitest';
import {
  DEMO_COURSE_ID,
  MockAgent,
  createChunkSource,
  formatPageRanges,
  runChat,
  summarizeLookup,
  toDeltas,
  type ChatEvent,
  type ChunkSource,
  type PageHit,
} from '../src/agent';
import { openDb } from '../src/db';
import { DocumentRepository } from '../src/db/repositories/documents';

type Done = Extract<ChatEvent, { type: 'done' }>;
type Usage = Extract<ChatEvent, { type: 'usage' }>;

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const source = () => createChunkSource(openDb(':memory:'));
const ask = (message: string, agent = new MockAgent(), src: ChunkSource = source()) =>
  collect(runChat(agent, src, { courseId: DEMO_COURSE_ID, message }));
const done = (events: ChatEvent[]) => events.find((e) => e.type === 'done') as Done;
const streamedText = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

describe('page helpers', () => {
  it('formats page ranges', () => {
    expect(formatPageRanges([41, 42, 43, 45])).toBe('41-43, 45');
    expect(formatPageRanges([48, 41, 41])).toBe('41, 48');
    expect(formatPageRanges([7])).toBe('7');
  });

  it('summarizes a lookup the way the chat shows it', () => {
    const h = (page: number) => ({ printedPage: page }) as PageHit;
    const eight = [41, 42, 43, 44, 45, 46, 47, 48].map(h);
    expect(summarizeLookup(eight)).toBe('Looked up pages 41-48');
    expect(summarizeLookup([h(5)])).toBe('Looked up page 5');
    expect(summarizeLookup([])).toContain('found nothing');
  });

  it('toDeltas rejoins to the exact original text', () => {
    const text = 'Hello  world.\n  Second line [1]';
    expect(toDeltas(text).join('')).toBe(text);
  });
});

describe('MockAgent over the demo course', () => {
  it('answers with a tool event, streamed text, usage and verified citations', async () => {
    const events = await ask('What is acceleration?');
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('tool-started');
    expect(types).toContain('tool-finished');
    expect(types).toContain('text');
    expect(types.filter((t) => t === 'usage')).toHaveLength(2);
    expect(types.at(-1)).toBe('done');

    const finished = events.find((e) => e.type === 'tool-finished');
    expect(finished && 'summary' in finished && finished.summary).toMatch(/^Looked up pages? \d/);

    const d = done(events);
    expect(d.abstained).toBe(false);
    expect(d.citations.length).toBeGreaterThan(0);
    expect(d.citations.every((c) => c.verified)).toBe(true);
    expect(d.text).toContain('[1]');
    expect(d.confidence).toBeGreaterThan(0);
    // Nothing had to be stripped, so the validated text equals what was streamed.
    expect(d.text).toBe(streamedText(events).trim());
  });

  it('is deterministic: the same question gives the same events', async () => {
    expect(await ask('Explain free fall')).toEqual(await ask('Explain free fall'));
  });

  it('cites printed pages (page + offset) for slides', async () => {
    const d = done(await ask('Remember the key equation for constant acceleration'));
    const slide = d.citations.find((c) => c.documentId === 'doc-slides');
    expect(slide).toBeDefined();
    expect(slide?.printedPage).toBe((slide?.page ?? 0) + 2);
  });

  it('reports usage that grows from input-only to input plus output', async () => {
    const usages = (await ask('What is velocity?')).filter((e): e is Usage => e.type === 'usage');
    expect(usages[0]?.outputTokens).toBe(0);
    expect(usages[0]?.inputTokens).toBeGreaterThan(0);
    expect(usages[1]?.outputTokens).toBeGreaterThan(0);
  });

  it('abstains on a question the material cannot answer, with no citations', async () => {
    const d = done(await ask('Who won the football world cup?'));
    expect(d.abstained).toBe(true);
    expect(d.citations).toEqual([]);
    expect(d.confidence).toBe(0);
  });

  it('abstains for a non-demo course that has no material', async () => {
    const db = openDb(':memory:');
    new DocumentRepository(db).ensureCourse('empty', 'Empty course');
    const events = await collect(
      runChat(new MockAgent(), createChunkSource(db), {
        courseId: 'empty',
        message: 'What is acceleration?',
      }),
    );
    expect(done(events).abstained).toBe(true);
  });
});

describe('answer-validate step inside the pipeline', () => {
  const extra = (over: Record<string, unknown>) => ({
    documentId: 'doc-book',
    chunkId: 'doc-book-p99',
    page: 99,
    printedPage: 99,
    quote: 'A page that does not exist.',
    ...over,
  });

  it('strips a citation the agent invented because no tool returned it', async () => {
    const events = await ask(
      'What is acceleration?',
      new MockAgent({ extraCitations: [extra({})] }),
    );
    const d = done(events);
    expect(streamedText(events)).toMatch(/\[4\]/); // streamed with the invented marker...
    expect(d.text).not.toMatch(/\[4\]/); // ...removed from the validated answer
    expect(d.citations.find((c) => c.chunkId === 'doc-book-p99')).toBeUndefined();
    expect(d.strippedCount).toBe(1);
    expect(d.citations.every((c) => c.verified)).toBe(true);
  });

  it('marks a wrong-page citation to a real chunk as unverified and keeps it', async () => {
    const wrong = extra({
      chunkId: 'doc-book-p44',
      page: 12,
      printedPage: 12,
      quote: 'Acceleration is the rate of change of velocity with time.',
    });
    const d = done(await ask('What is acceleration?', new MockAgent({ extraCitations: [wrong] })));
    const bad = d.citations.filter((c) => !c.verified);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.reason).toBe('page_mismatch');
    expect(d.unverifiedCount).toBe(1);
  });
});
