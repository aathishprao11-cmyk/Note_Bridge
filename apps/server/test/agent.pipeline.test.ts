import { describe, expect, it } from 'vitest';
import {
  DEMO_COURSE_ID,
  createChunkSource,
  runChat,
  type Agent,
  type ChatEvent,
  type ToolRunner,
} from '../src/agent';
import { openDb } from '../src/db';

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const source = () => createChunkSource(openDb(':memory:'));
const req = { courseId: DEMO_COURSE_ID, message: 'acceleration' };

describe('pipeline safety', () => {
  it('turns an agent crash into an error event instead of throwing', async () => {
    const boom: Agent = {
      id: 'boom',
      async *run() {
        throw new Error('model exploded');
      },
    };
    expect(await collect(runChat(boom, source(), req))).toEqual([
      { type: 'error', code: 'agent_failed', message: 'model exploded' },
    ]);
  });

  it('errors when the agent ends without an answer', async () => {
    const silent: Agent = { id: 'silent', async *run() {} };
    const events = await collect(runChat(silent, source(), req));
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
    const events = await collect(runChat(greedy, source(), req, { maxToolCalls: 2 }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'tool_limit' });
    expect(events.filter((e) => e.type === 'tool-finished')).toHaveLength(2);
  });

  it('only lets a citation pass if a tool returned that chunk, even for real-looking ids', async () => {
    // The agent never calls a tool, then cites a chunk that exists in the corpus.
    const lazy: Agent = {
      id: 'lazy',
      async *run() {
        yield {
          type: 'draft',
          draft: {
            text: 'Acceleration is the rate of change of velocity [1].',
            abstained: false,
            citations: [
              {
                documentId: 'doc-book',
                chunkId: 'doc-book-p44',
                page: 44,
                printedPage: 44,
                quote: 'Acceleration is the rate of change of velocity with time.',
              },
            ],
          },
        };
      },
    };
    const done = (await collect(runChat(lazy, source(), req))).at(-1) as Extract<
      ChatEvent,
      { type: 'done' }
    >;
    expect(done.abstained).toBe(true);
    expect(done.citations).toEqual([]);
    expect(done.strippedCount).toBe(1);
  });
});
