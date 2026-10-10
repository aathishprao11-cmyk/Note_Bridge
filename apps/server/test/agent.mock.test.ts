import { describe, expect, it } from 'vitest';
import { CitationSchema, demo } from '@gyan/core';
import {
  MockAgent,
  formatPageRanges,
  quoteOf,
  runChat,
  summarizeLookup,
  toDeltas,
  type PageHit,
} from '../src/agent';
import { COURSE, collect, doneOf, seededSource, streamedText } from './agent-helpers';

const ask = async (message: string, agent = new MockAgent()) =>
  collect(runChat(agent, await seededSource(), { courseId: COURSE, message }));

describe('page helpers', () => {
  it('formats page ranges', () => {
    expect(formatPageRanges([41, 42, 43, 45])).toBe('41-43, 45');
    expect(formatPageRanges([48, 41, 41])).toBe('41, 48');
    expect(formatPageRanges([7])).toBe('7');
  });

  it('summarizes a lookup the way the chat shows it', () => {
    const h = (page: number) => ({ printedPage: page }) as PageHit;
    expect(summarizeLookup([41, 42, 43, 44, 45, 46, 47, 48].map(h))).toBe('Looked up pages 41-48');
    expect(summarizeLookup([h(5)])).toBe('Looked up page 5');
    expect(summarizeLookup([])).toBe('No relevant passages found');
  });

  it('toDeltas rejoins to the exact original text', () => {
    const text = 'Hello  world.\n  Second line [1]';
    expect(toDeltas(text).join('')).toBe(text);
  });

  it('quoteOf stays under the contract limit of 20 words', () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ') + '.';
    expect(quoteOf(long).split(' ').length).toBeLessThanOrEqual(20);
  });
});

describe('MockAgent over the seeded demo course', () => {
  it('answers with tool events, streamed text, usage and verified citations', async () => {
    const events = await ask('What is acceleration?');
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('tool-started');
    expect(types).toContain('tool-finished');
    expect(types).toContain('text');
    expect(types.filter((t) => t === 'usage')).toHaveLength(2);
    expect(types.at(-1)).toBe('done');

    const finished = events.find((e) => e.type === 'tool-finished');
    expect(finished).toMatchObject({ ok: true, call: { name: 'search_notes' } });
    expect(finished && 'call' in finished && finished.call.summary).toMatch(/^Looked up pages? \d/);

    const d = doneOf(events)!;
    expect(d.abstained).toBe(false);
    expect(d.citations.length).toBeGreaterThan(0);
    expect(d.citations.every((c) => c.status === 'verified')).toBe(true);
    expect(d.content).toContain('[1]');
    expect(d.confidence).toBeGreaterThan(0);
    expect(d.messageId).toMatch(/^msg_/);
    // Nothing had to be stripped, so the validated text equals what was streamed.
    expect(d.content).toBe(streamedText(events).trim());
  });

  it("answers the brief's acceptance question with tool calls and a validated, cited answer", async () => {
    const events = await ask("Why does my professor's position formula differ from the book's?");
    expect(events.some((e) => e.type === 'tool-started')).toBe(true);
    const d = doneOf(events)!;
    expect(d.abstained).toBe(false);
    expect(d.citations.every((c) => c.status === 'verified')).toBe(true);
    // The first citation is the book's position equation: pdf page 6, printed page 3.
    expect(d.citations[0]).toMatchObject({ chunkId: 'chk_04', page: 6, printedPage: 3 });
  });

  it('cites real seeded chunks, with printed pages from the database (offset -3)', async () => {
    const d = doneOf(await ask('What is acceleration?'))!;
    const seeded = new Map(demo.chunks.map((c) => [c.id, c]));
    for (const c of d.citations) {
      const chunk = seeded.get(c.chunkId);
      expect(chunk).toBeDefined();
      expect(c.page).toBe(chunk?.page);
      expect(c.printedPage).toBe((chunk?.page ?? 0) - 3);
      expect(chunk?.text).toContain(c.quote);
    }
  });

  it('every citation it sends passes the frozen contract schema', async () => {
    const d = doneOf(await ask('Explain Newton second law'))!;
    expect(d.citations.length).toBeGreaterThan(0);
    for (const c of d.citations) expect(CitationSchema.safeParse(c).success).toBe(true);
  });

  it('is deterministic: the same question gives the same events (apart from the message id)', async () => {
    const strip = (es: Awaited<ReturnType<typeof ask>>) =>
      es.map((e) => (e.type === 'done' ? { ...e, messageId: '' } : e));
    expect(strip(await ask('Explain free fall'))).toEqual(strip(await ask('Explain free fall')));
  });

  it('reports usage that grows from input-only to input plus output', async () => {
    const usages = (await ask('What is velocity?')).filter((e) => e.type === 'usage');
    expect(usages[0]).toMatchObject({ outputTokens: 0 });
    expect(usages[1]).toMatchObject({ outputTokens: expect.any(Number) });
    expect(usages[0] && 'inputTokens' in usages[0] && usages[0].inputTokens).toBeGreaterThan(0);
  });

  it('abstains on a question the material cannot answer, with no citations', async () => {
    const d = doneOf(await ask('What does my textbook say about quantum tunnelling?'))!;
    expect(d.abstained).toBe(true);
    expect(d.citations).toEqual([]);
    expect(d.confidence).toBeNull();
    expect(d.content).toBe('Not found in your uploaded material.');
  });
});
