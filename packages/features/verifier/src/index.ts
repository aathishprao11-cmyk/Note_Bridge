import type { FeaturePlugin, PluginContext } from '@gyan/core';
import { DEMO_SCRIPTS, MockScriptWriter } from './scriptWriter';
import type { SandboxRun, ScriptWriter, VerifyRequest } from './types';
import { verify } from './verify';

export * from './types';
export * from './compare';
export * from './scriptWriter';
export { verify } from './verify';
export type { VerifyDeps } from './verify';

export interface VerifierOptions {
  /** Runs code in the sandbox. Injected by the server; the plugin never spawns processes itself. */
  run?: SandboxRun;
  /** Writes the script for a claim. Defaults to the mock writer until the real agent exists. */
  writer?: ScriptWriter;
}

function parseBody(body: unknown): VerifyRequest | null {
  const b = body as Partial<VerifyRequest> | null;
  if (!b || typeof b.claim !== 'string' || typeof b.expected !== 'string') return null;
  const language = b.language === 'python3' || b.language === 'node' ? b.language : undefined;
  return language
    ? { claim: b.claim, expected: b.expected, language }
    : { claim: b.claim, expected: b.expected };
}

export function createVerifierPlugin(options: VerifierOptions = {}): FeaturePlugin & {
  attachSandbox(run: SandboxRun): void;
} {
  let run = options.run;
  const writer = options.writer ?? new MockScriptWriter(DEMO_SCRIPTS);

  return {
    id: 'verifier',
    name: 'Verified by running code',
    version: '0.1.0',
    attachSandbox(next: SandboxRun) {
      run = next;
    },
    register(ctx: PluginContext): void {
      ctx.addUiPanel({
        id: 'verifier',
        title: 'Verified by running code',
        icon: 'check',
        mount: 'chat',
        componentPath: 'verifier',
      });
      // Mounted at POST /api/features/verifier/verify
      ctx.addRoutes('', (app) => {
        app.post('/verify', async (req) => {
          const body = parseBody(req.body);
          if (!body) {
            return {
              error: { code: 'invalid_request', message: 'Body must be { claim, expected }.' },
            };
          }
          if (!run) {
            ctx.logger.warn('verifier: no sandbox attached; /verify cannot run code');
            return {
              status: 'error',
              claim: body.claim,
              reason: 'sandbox_unavailable',
              message: 'The code sandbox is not available on this server.',
            };
          }
          return verify(body, { writer, run });
        });
      });
    },
  };
}

export const plugin = createVerifierPlugin();
export default plugin;
