import {
  chatConfidence,
  markUnverifiedRefs,
  refChecker,
  validateAnswerText,
  type Chunk,
  type ChatEventPayload,
} from '@gyan/core';
import type { Db } from '../db';
import { IngestStore } from '../db/repositories/ingest-store';

/**
 * Answer validation for the CANNED chat answers (the contract fixtures behind
 * GET /chat/examples and the stub POST /chat). The live Study Agent has its own pipeline
 * (apps/server/src/agent/validate.ts, Laptop B); this applies the same BRIEF 9.2 rules to the
 * canned ones, so "verified" / "unverified" is COMPUTED here, not hard-coded in a fixture:
 *  - a cited chunk must have been returned by a tool call in the same example;
 *  - its quote must match the chunk text, and its pages come from the stored chunk;
 *  - a [Doc, p.N] that no tool returned is marked "(unverified citation)" in the text;
 *  - a number nothing supports is flagged as an unverified calculation;
 *  - confidence is recomputed from the verified share, never taken from the fixture.
 */

const STOP = new Set(['the', 'and', 'for', 'what', 'does', 'that', 'this', 'with', 'from', 'your']);
const words = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/** The book chunks of a course, by id, plus document titles. */
function loadCorpus(db: Db, courseId: string) {
  const store = new IngestStore(db);
  const docs = db
    .prepare("SELECT id, title FROM documents WHERE course_id = ? AND kind = 'book'")
    .all(courseId) as Array<{ id: string; title: string }>;
  const chunks = docs.flatMap((d) => store.chunks(d.id));
  const exercises = docs.flatMap((d) => store.exercises(d.id));
  return {
    chunks,
    exercises,
    byId: new Map(chunks.map((c) => [c.id, c])),
    titles: Object.fromEntries(docs.map((d) => [d.id, d.title])),
  };
}

/**
 * Which chunks did a (canned) tool call return? Mirrors what the real tools return, so a canned
 * answer can only cite what its own tool calls looked up. Page arguments are PDF pages.
 */
function chunksReturnedBy(
  db: Db,
  courseId: string,
  corpus: ReturnType<typeof loadCorpus>,
  name: string,
  input: Record<string, unknown>,
): Chunk[] {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const num = (k: string): number => (typeof input[k] === 'number' ? (input[k] as number) : NaN);
  switch (name) {
    case 'get_book_section': {
      const from = num('page_start');
      const to = Number.isNaN(num('page_end')) ? from : num('page_end');
      return corpus.chunks.filter(
        (c) =>
          (!str('book_id') || c.documentId === str('book_id')) &&
          c.pdfPageStart <= to &&
          c.pdfPageEnd >= from,
      );
    }
    case 'get_conflicts': {
      const target = str('topic_or_unit_id');
      const ids = (
        db
          .prepare(
            `SELECT e.chunk_id FROM alignment_edges e JOIN lecture_units u ON u.id = e.unit_id
             JOIN documents d ON d.id = u.document_id
             WHERE d.course_id = ? AND e.relation = 'conflicts' AND e.claim_verdict = 'yes'
               AND (u.id = ? OR u.title LIKE ?)`,
          )
          .all(courseId, target, `%${target}%`) as Array<{ chunk_id: string }>
      ).map((r) => r.chunk_id);
      return ids.flatMap((id) => corpus.byId.get(id) ?? []);
    }
    case 'find_exercises': {
      const topic = words(str('topic'));
      return corpus.exercises
        .filter((x) => {
          const hay = `${x.statement} ${x.topicTags.join(' ')}`.toLowerCase();
          return topic.some((w) => hay.includes(w));
        })
        .flatMap((x) => (x.chunkId ? (corpus.byId.get(x.chunkId) ?? []) : []));
    }
    case 'search_notes': {
      const q = new Set(words(str('query')));
      return corpus.chunks.filter((c) => words(c.text).some((w) => q.has(w)));
    }
    default:
      return [];
  }
}

/**
 * Run answer-validation over a canned event list. Pure per call: events in, events out. Text
 * deltas get "(unverified citation)" marks; the `done` event gets validated citations, content,
 * unverifiedCalculation and a computed confidence.
 */
export function validateCannedEvents(
  db: Db,
  courseId: string,
  question: string,
  events: ChatEventPayload[],
): ChatEventPayload[] {
  const corpus = loadCorpus(db, courseId);
  const retrieved = new Map<string, Chunk>();
  let ranVerification = false;
  const known: string[] = [question];

  return events.map((event): ChatEventPayload => {
    if (event.type === 'tool-finished') {
      known.push(JSON.stringify(event.call.input));
      if (event.call.name === 'run_verification') ranVerification = true;
      if (event.ok) {
        for (const c of chunksReturnedBy(db, courseId, corpus, event.call.name, event.call.input)) {
          retrieved.set(c.id, c);
        }
      }
      return event;
    }
    if (event.type === 'text') {
      const ok = refChecker([...retrieved.values()], corpus.titles);
      return { ...event, delta: markUnverifiedRefs(event.delta, ok) };
    }
    if (event.type === 'done') {
      const checked = validateAnswerText({
        text: event.content,
        citations: event.citations,
        retrieved: [...retrieved.values()],
        docTitles: corpus.titles,
        quoteMatchMin: 0.9,
        ranVerification,
        knownText: known.join(' '),
      });
      return {
        ...event,
        content: checked.text,
        citations: checked.citations,
        unverifiedCalculation: checked.unverifiedCalculation,
        confidence: chatConfidence({
          citations: checked.citations,
          abstained: event.abstained,
          unverifiedCalculation: checked.unverifiedCalculation,
        }),
      };
    }
    return event;
  });
}
