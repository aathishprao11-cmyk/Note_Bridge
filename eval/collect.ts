import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentResponse,
  ChatEvent,
  MockEmbeddingProvider,
  countsAsEdge,
  parseConfig,
  verifyQuoteText,
  type ChatEventPayload,
} from '../packages/core/src';
import { buildApp } from '../apps/server/src/app';
import { seedDemo } from '../apps/server/src/db/seed-demo';
import { parseCsvLine } from './csv';
import { containsExactly, type Prediction } from './score';

const COURSE = 'course_demo';
const EDGE_MIN = 0.5;
const here = (f: string) => join(dirname(fileURLToPath(import.meta.url)), f);

export interface EdgeEvidence {
  edgeId: string;
  /** The stored flag says both quotes were verified. */
  storedVerified: boolean;
  /** Production fuzzy verifier on the stored text (what the code computes). */
  computedVerified: boolean;
  /** Independent, stricter exact-containment check. */
  exactBoth: boolean;
}

export interface Collected {
  keyText: string;
  predsByUnit: Map<string, Prediction[]>;
  evidence: EdgeEvidence[];
  /** Citations the chat SHOWED as verified, each re-checked against stored chunk text. */
  shownVerified: Array<{ chunkId: string; exact: boolean; pageOk: boolean }>;
  /** Citations the chat marked unverified (the system caught them). */
  caught: number;
  unanswerable: Array<{ question: string; abstained: boolean }>;
  /** Answerable questions the chat abstained on (a miss, reported, not gated). */
  answerableAbstained: number;
  answerableAsked: number;
}

const ANSWERABLE = [
  'What is the formula for position under constant acceleration?',
  'How is Newton second law stated and what is the momentum form?',
  'How is average velocity defined in the book?',
];

async function ask(app: Awaited<ReturnType<typeof buildApp>>['app'], message: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/courses/${COURSE}/chat`,
    payload: { message },
  });
  if (res.statusCode !== 200) return null;
  const events: ChatEventPayload[] = res.body
    .split('\n\n')
    .filter(Boolean)
    .map((c) => ChatEvent.parse(JSON.parse(c.replace(/^data: /, ''))));
  return events.find((e) => e.type === 'done') ?? null;
}

export async function collect(): Promise<Collected> {
  const built = await buildApp({ config: parseConfig({ DATABASE_PATH: ':memory:' }) });
  const { app, db } = built;
  await seedDemo(db, new MockEmbeddingProvider(16));

  const res = await app.inject({ method: 'GET', url: `/api/courses/${COURSE}/alignment` });
  const map = AlignmentResponse.parse(res.json());
  const unitText = new Map(map.units.map((u) => [u.unit.id, u.unit.text]));
  const chunkText = new Map(
    (db.prepare('SELECT id, text FROM chunks').all() as Array<{ id: string; text: string }>).map(
      (c) => [c.id, c.text],
    ),
  );

  const predsByUnit = new Map<string, Prediction[]>();
  const evidence: EdgeEvidence[] = [];
  for (const e of map.edges) {
    const ref = map.chunks[e.chunkId];
    if (!ref) continue;
    const list = predsByUnit.get(e.unitId) ?? [];
    list.push({
      book: ref.documentTitle,
      printedStart: ref.printedPageStart ?? ref.pdfPageStart,
      printedEnd: ref.printedPageEnd ?? ref.pdfPageEnd,
      confidence: e.confidence,
      counted: countsAsEdge(e, EDGE_MIN),
    });
    predsByUnit.set(e.unitId, list);

    const book = chunkText.get(e.chunkId) ?? '';
    const unit = unitText.get(e.unitId) ?? '';
    evidence.push({
      edgeId: e.id,
      storedVerified: e.quoteVerified,
      computedVerified:
        verifyQuoteText(book, e.evidenceBook, 0.9) && verifyQuoteText(unit, e.evidenceUnit, 0.9),
      exactBoth: containsExactly(book, e.evidenceBook) && containsExactly(unit, e.evidenceUnit),
    });
  }

  const shownVerified: Collected['shownVerified'] = [];
  let caught = 0;
  let answerableAbstained = 0;
  for (const q of ANSWERABLE) {
    const done = await ask(app, q);
    if (!done || done.type !== 'done') continue;
    if (done.abstained) answerableAbstained++;
    for (const c of done.citations) {
      if (c.status !== 'verified') {
        caught++;
        continue;
      }
      const row = db
        .prepare('SELECT text, printed_page_start AS p FROM chunks WHERE id = ?')
        .get(c.chunkId) as { text: string; p: number | null } | undefined;
      shownVerified.push({
        chunkId: c.chunkId,
        exact: row !== undefined && containsExactly(row.text, c.quote),
        pageOk: row !== undefined && row.p === c.printedPage,
      });
    }
  }

  const unanswerable: Collected['unanswerable'] = [];
  const lines = readFileSync(here('unanswerable.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const question = parseCsvLine(line)[0] ?? '';
    const done = await ask(app, question);
    unanswerable.push({ question, abstained: done?.type === 'done' && done.abstained });
  }

  await app.close();
  return {
    keyText: readFileSync(here('labeled.csv'), 'utf8'),
    predsByUnit,
    evidence,
    shownVerified,
    caught,
    unanswerable,
    answerableAbstained,
    answerableAsked: ANSWERABLE.length,
  };
}
