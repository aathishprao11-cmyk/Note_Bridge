import type { FastifyInstance } from 'fastify';
import type {
  AgentToolDefinition,
  FeaturePlugin,
  JobHandler,
  PluginContext,
  PluginEvent,
  UiPanelManifest,
} from '@gyan/core';

/**
 * Plugin ids map to workspace packages: PLUGINS=conflicts -> @gyan/feature-conflicts.
 * A feature package must default-export (or export `plugin`) a FeaturePlugin.
 * Routes are mounted under /api/features/<plugin id>/... (BRIEF Section 14).
 */
export function packageNameFor(id: string): string {
  return `@gyan/feature-${id}`;
}

export type PluginImporter = (specifier: string) => Promise<unknown>;

export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  routes: number;
  tools: string[];
  panels: UiPanelManifest[];
  jobTypes: string[];
}

/** What plugins registered, kept so the agent, job runner and web app can read it. */
export class PluginRegistry {
  readonly tools: AgentToolDefinition[] = [];
  readonly panels: UiPanelManifest[] = [];
  readonly jobHandlers = new Map<string, JobHandler>();
  private readonly listeners = new Map<PluginEvent, Array<(payload: unknown) => void>>();

  on(event: PluginEvent, handler: (payload: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
  }

  /** A failing listener never stops the others or the caller. */
  emit(event: PluginEvent, payload: unknown): void {
    for (const h of this.listeners.get(event) ?? []) {
      try {
        h(payload);
      } catch {
        /* isolated on purpose */
      }
    }
  }
}

/** The shared part of the context; the loader adds the per-plugin registration methods. */
export type BaseContext = Omit<
  PluginContext,
  'addRoutes' | 'addAgentTool' | 'addUiPanel' | 'addJobHandler' | 'on'
>;

function isPlugin(value: unknown): value is FeaturePlugin {
  const p = value as Partial<FeaturePlugin> | null;
  return !!p && typeof p.id === 'string' && typeof p.register === 'function';
}

export async function loadPlugins(
  app: FastifyInstance,
  base: BaseContext,
  ids: string[],
  registry: PluginRegistry = new PluginRegistry(),
  importer: PluginImporter = (s) => import(s),
): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  for (const id of ids) {
    let mod: Record<string, unknown>;
    try {
      mod = (await importer(packageNameFor(id))) as Record<string, unknown>;
    } catch (err) {
      // A missing/broken plugin must not take the whole server down.
      base.logger.warn(`plugin "${id}" failed to load`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const plugin = [mod.default, mod.plugin].find(isPlugin);
    if (!plugin) {
      base.logger.warn(`plugin "${id}" does not export a FeaturePlugin`);
      continue;
    }
    const missing = (plugin.requires ?? []).filter((r) => !ids.includes(r));
    if (missing.length > 0) {
      base.logger.warn(`plugin "${id}" skipped: requires ${missing.join(', ')}`);
      continue;
    }

    const mine: LoadedPlugin = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      routes: 0,
      tools: [],
      panels: [],
      jobTypes: [],
    };
    const ctx: PluginContext = {
      ...base,
      addRoutes(prefix, fn) {
        mine.routes += 1;
        void app.register(async (scope) => fn(scope), {
          prefix: `/api/features/${plugin.id}${prefix}`,
        });
      },
      addAgentTool(tool) {
        registry.tools.push(tool);
        mine.tools.push(tool.name);
      },
      addUiPanel(panel) {
        registry.panels.push(panel);
        mine.panels.push(panel);
      },
      addJobHandler(type, handler) {
        registry.jobHandlers.set(type, handler);
        mine.jobTypes.push(type);
      },
      on: (event, handler) => registry.on(event, handler),
    };
    try {
      await plugin.register(ctx);
    } catch (err) {
      base.logger.error(`plugin "${id}" failed to register`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    loaded.push(mine);
  }
  return loaded;
}
