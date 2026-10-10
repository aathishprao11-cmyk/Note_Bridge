import { MockEmbeddingProvider, parseConfig, demo } from '@gyan/core';
import { buildApp } from '../src/app';
import type { Agent, AnswerDraft, ChatEvent, DraftCitation, PageHit } from '../src/agent';
import { createChunkSource } from '../src/agent';
import { seedDemo } from '../src/db/seed-demo';
import { openDb } from '../src/db';

export const COURSE = demo.course.id;

/** An in-memory database with the demo course loaded (mock embeddings: nothing is downloaded). */
export async function seededDb() {
  const db = openDb(':memory:');
  await seedDemo(db, new MockEmbeddingProvider(16));
  return db;
}

export async function seededSource() {
  return createChunkSource(await seededDb());
}

export async function seededApp(agent?: Agent) {
  const built = await buildApp({ config: parseConfig({ DATABASE_PATH: ':memory:' }), agent });
  await seedDemo(built.db, new MockEmbeddingProvider(16));
  return built;
}

export async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

export const doneOf = (events: ChatEvent[]) =>
  events.find((e): e is Extract<ChatEvent, { type: 'done' }> => e.type === 'done');

export const streamedText = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

export const hit = (over: Partial<PageHit> = {}): PageHit => ({
  chunkId: 'c1',
  documentId: 'doc-book',
  documentTitle: 'Book',
  role: 'book',
  page: 41,
  printedPage: 41,
  text: 'Displacement is the change in position of an object.',
  score: 0.8,
  ...over,
});

export const cite = (over: Partial<DraftCitation> = {}): DraftCitation => ({
  documentId: 'doc-book',
  chunkId: 'c1',
  page: 41,
  printedPage: 41,
  quote: 'Displacement is the change in position of an object.',
  ...over,
});

export const draft = (text: string, citations: DraftCitation[]): AnswerDraft => ({
  text,
  citations,
  abstained: false,
});
