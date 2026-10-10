import { describe, expect, it } from 'vitest';
import { MockAgent, runChat, type Agent, type ToolRunner } from '../src/agent';
import { COURSE, collect, doneOf, seededSource, streamedText } from './agent-helpers';

const req = { courseId: COURSE, message: 'What is acceleration?' };

// A real chunk of the seeded book, used to build invented and wrong citations around.
const REAL = {
  documentId: 'doc_book',
  chunkId: 'chk_02',
  page: 5,
  printedPage: 2,
  quote:
    'Acceleration is the rate of change of velocity, a = dv/dt, and it is also a vector quantity.',
};

describe('answer-validate step inside the pipeline', () => {
  it('strips a citation the agent invented because no tool returned it', async () => {
    const invented = { ...REAL, chunkId: 'chk_made_up', page: 99, printedPage: 96, quote: 'No.' };
    const events = await collect(
      runChat(new MockAgent({ extraCitations: [invented] }), await seededSource(), req),
    );
    const d = doneOf(events)!;
    expect(streamedText(events)).toMatch(/\[4\]/); // streamed with the invented marker...
    expect(d.content).not.toMatch(/\[4\]/); // ...removed from the validated answer
    expect(d.citations.find((c) => c.chunkId === 'chk_made_up')).toBeUndefined();
    expect(d.citations.every((c) => c.status === 'verified')).toBe(true);
  });

  it('marks a wrong-page citation to a real, returned chunk as "unverified" and keeps it', async () => {
    const wrong = { ...REAL, page: 12, printedPage: 9 };
    const events = await collect(
      runChat(new MockAgent({ extraCitations: [wrong] }), await seededSource(), req),
    );
    const d = doneOf(events)!;
    const bad = d.citations.filter((c) => c.status === 'unverified');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ chunkId: 'chk_02', page: 12 });
  });

  it('only lets a citation pass if a tool returned that chunk, even for a real chunk id', async () => {
    // The agent never calls a tool, then cites a chunk that exists in the database.
    const lazy: Agent = {
      id: 'lazy',
      async *run() {
        yield {
          type: 'draft',
          draft: { text: `Acceleration is a vector [1].`, abstained: false, citations: [REAL] },
        };
      },
    };
    const d = doneOf(await collect(runChat(lazy, await seededSource(), req)))!;
    expect(d.abstained).toBe(true);
    expect(d.citations).toEqual([]);
  });
});

describe('pipeline safety', () => {
  it('turns an agent crash into an error event instead of throwing', async () => {
    const boom: Agent = {
      id: 'boom',
      async *run() {
        throw new Error('model exploded');
      },
    };
    expect(await collect(runChat(boom, await seededSource(), req))).toEqual([
      { type: 'error', code: 'agent_failed', message: 'model exploded' },
    ]);
  });

  it('errors when the agent ends without an answer', async () => {
    const silent: Agent = { id: 'silent', async *run() {} };
    const events = await collect(runChat(silent, await seededSource(), req));
    expect(events[0]).toMatchObject({ type: 'error', code: 'no_answer' });
  });

  it('enforces the tool-call limit', async () => {
    const greedy: Agent = {
      id: 'greedy',
      async *run(_req, tools: ToolRunner) {
        for (let i = 0; i < 5; i++) {
          const call = tools.search('acceleration');
          yield call.started;
          yield (await call.finish()).finished;
        }
      },
    };
    const events = await collect(runChat(greedy, await seededSource(), req, { maxToolCalls: 2 }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'tool_limit' });
    expect(events.filter((e) => e.type === 'tool-finished')).toHaveLength(2);
  });

  it('reports a failing lookup as ok:false and then abstains', async () => {
    const source = await seededSource();
    source.search = async () => {
      throw new Error('db down');
    };
    const events = await collect(runChat(new MockAgent(), source, req));
    expect(events.find((e) => e.type === 'tool-finished')).toMatchObject({
      ok: false,
      call: { summary: 'The search failed' },
    });
    expect(doneOf(events)?.abstained).toBe(true);
  });
});
