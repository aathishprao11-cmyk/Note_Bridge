import type { FastifyInstance } from 'fastify';
import type { Config } from './config-schema';
import type { GroundingService } from './ground';
import type { EmbeddingProvider, LLMProvider } from './providers/llm';
import type { RetrievalService } from './retrieve';
import type { VectorIndex } from './vector';

/**
 * SHARED CONTRACT (frozen) - BRIEF Section 6. A feature never imports another feature; it only
 * talks to core through PluginContext. Disabling a plugin removes its routes, tools and panels.
 */

/** The slice of the SQLite handle plugins may use (better-sqlite3 satisfies it). */
export interface DbStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface Db {
  prepare(sql: string): DbStatement;
  exec(sql: string): unknown;
  transaction<T>(fn: () => T): () => T;
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

/** A tool the Study Agent can call. `run` gets already-validated JSON input. */
export interface AgentToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<unknown>;
}

export interface UiPanelManifest {
  id: string;
  title: string;
  icon: string;
  mount: 'course' | 'unit' | 'chunk' | 'chat';
  /** Path of the React component, relative to the web app's features folder. */
  componentPath: string;
}

export type JobHandler = (
  job: { id: string; payload: unknown },
  report: (progress: number, message: string) => void,
) => Promise<void>;

export type PluginEvent = 'alignment.completed' | 'edge.updated';

export interface PluginContext {
  db: Db;
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
  vector: VectorIndex;
  /** Grounded hybrid retrieval, available to every plugin. */
  retrieve: RetrievalService;
  /** Citation, quote and claim validators. */
  ground: GroundingService;
  logger: Logger;
  config: Config;
  /** Mounts routes under /api/features/<plugin id><prefix>. */
  addRoutes(prefix: string, fn: (app: FastifyInstance) => void): void;
  addAgentTool(tool: AgentToolDefinition): void;
  addUiPanel(panel: UiPanelManifest): void;
  addJobHandler(type: string, handler: JobHandler): void;
  on(event: PluginEvent, handler: (payload: unknown) => void): void;
}

export interface FeaturePlugin {
  id: string;
  name: string;
  version: string;
  /** Ids of other plugins that must be enabled for this one to load. */
  requires?: string[];
  register(ctx: PluginContext): void | Promise<void>;
}
