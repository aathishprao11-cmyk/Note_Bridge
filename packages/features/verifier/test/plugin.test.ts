import { describe, expect, it, vi } from 'vitest';
import { parseConfig, type PluginContext } from '@gyan/core';
import { createVerifierPlugin, type SandboxRun } from '../src';

const printing =
  (stdout: string): SandboxRun =>
  async () => ({
    ok: true,
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
    truncated: false,
    durationMs: 5,
    mode: 'local',
  });
type Handler = (req: { body: unknown }) => Promise<unknown>;

/** Registers the plugin against a fake context and returns the routes it added. */
async function register(plugin: ReturnType<typeof createVerifierPlugin>) {
  const routes = new Map<string, Handler>();
  const panels: unknown[] = [];
  const ctx = {
    config: parseConfig({}),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    addUiPanel: (p: unknown) => panels.push(p),
    addRoutes: (_prefix: string, fn: (app: unknown) => void) =>
      fn({ post: (path: string, h: Handler) => routes.set(`POST ${path}`, h) }),
  } as unknown as PluginContext;
  await plugin.register(ctx);
  return { routes, panels };
}
const body = { claim: 'sum of the integers 1 to 100', expected: '5050' };

describe('verifier plugin', () => {
  it('exposes POST /verify and uses the injected sandbox', async () => {
    const { routes, panels } = await register(createVerifierPlugin({ run: printing('5050\n') }));
    expect([...routes.keys()]).toEqual(['POST /verify']);
    expect(panels).toHaveLength(1);
    const res = (await routes.get('POST /verify')!({ body })) as { status: string };
    expect(res.status).toBe('verified');
  });

  it('rejects a malformed body', async () => {
    const { routes } = await register(createVerifierPlugin({ run: printing('1') }));
    const res = (await routes.get('POST /verify')!({ body: { claim: 1 } })) as {
      error: { code: string };
    };
    expect(res.error.code).toBe('invalid_request');
  });

  it('reports the sandbox as unavailable until one is attached', async () => {
    const plugin = createVerifierPlugin();
    const { routes } = await register(plugin);
    const verify = routes.get('POST /verify')!;
    expect(await verify({ body })).toMatchObject({
      status: 'error',
      reason: 'sandbox_unavailable',
    });
    plugin.attachSandbox(printing('5050'));
    expect(await verify({ body })).toMatchObject({ status: 'verified' });
  });
});
