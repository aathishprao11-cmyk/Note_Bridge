import type { ChunkSource } from './source';
import { ToolRunner } from './tools';
import type { Agent, ChatEvent, ChatRequest } from './types';
import { validateAnswer, type ValidateOptions } from './validate';

export interface PipelineOptions extends ValidateOptions {
  maxToolCalls?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/**
 * Runs an agent and turns its output into the chat event stream. Streams the agent's text, tool
 * and usage events as they happen, then validates the final draft against what the tools returned
 * and emits `done` with the validated answer. Never throws: a failure becomes an `error` event.
 */
export async function* runChat(
  agent: Agent,
  source: ChunkSource,
  req: ChatRequest,
  options: PipelineOptions = {},
): AsyncGenerator<ChatEvent> {
  const tools = new ToolRunner(source, req.courseId, options.maxToolCalls);
  let finished = false;
  try {
    for await (const event of agent.run(req, tools)) {
      if (event.type === 'draft') {
        const validated = validateAnswer(event.draft, tools.returned, options);
        finished = true;
        yield { type: 'done', ...validated };
        return;
      }
      yield event;
    }
    if (!finished) {
      yield { type: 'error', code: 'no_answer', message: 'The agent ended without an answer.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.log?.('chat failed', { error: message });
    yield {
      type: 'error',
      code: err instanceof Error && err.name === 'ToolLimitError' ? 'tool_limit' : 'agent_failed',
      message,
    };
  }
}
