import type { Config } from '@gyan/core';
import { MockAgent } from './mock';
import type { Agent } from './types';

export * from './types';
export * from './source';
export * from './tools';
export * from './validate';
export { MockAgent, firstSentence, estimateTokens, toDeltas } from './mock';
export { runChat } from './pipeline';
export { registerChatRoutes } from './route';
export { DEMO_COURSE_ID, DEMO_CHUNKS } from './corpus';

/**
 * Picks the agent. Only the deterministic MockAgent exists so far; asking for a real provider logs
 * a warning and still uses the mock, so the chat page works without any key.
 */
export function createAgent(
  config: Pick<Config, 'LLM_PROVIDER'>,
  log: (message: string) => void = () => {},
  delayMs = 12,
): Agent {
  if (config.LLM_PROVIDER !== 'mock') {
    log(
      `LLM_PROVIDER=${config.LLM_PROVIDER}: the real study agent is not built yet, chat uses the deterministic MockAgent.`,
    );
  }
  return new MockAgent({ delayMs });
}
