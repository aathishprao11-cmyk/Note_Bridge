import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  InMemoryVectorIndex,
  createEmbeddingProvider,
  createLLMProvider,
  redactConfig,
  type Config,
  type Logger,
} from '@gyan/core';
import { createAgent, createChunkSource, registerStudyChatRoute, type Agent } from './agent';
import { openDb, type Db } from './db';
import { DocumentRepository } from './db/repositories/documents';
import { IngestStore } from './db/repositories/ingest-store';
import { JobRepository } from './db/repositories/jobs';
import { JobRunner, ProgressBus } from './jobs';
import {
  loadPlugins,
  PluginRegistry,
  type LoadedPlugin,
  type PluginImporter,
} from './plugins/loader';
import { placeholderGrounding, placeholderRetrieval } from './plugins/placeholder-services';
import { registerAlignmentRoutes } from './routes/alignment';
import { registerChatRoutes } from './routes/chat';
import { registerCourseRoutes } from './routes/courses';
import { registerDocumentRoutes } from './routes/documents';
import { registerIngestRoutes } from './routes/ingest';
import { createSandbox, type Sandbox } from './sandbox';

/** A plugin that wants to run code exposes attachSandbox; the server hands it the sandbox. */
function withSandbox(importer: PluginImporter, sandbox: Sandbox): PluginImporter {
  return async (specifier) => {
    const mod = (await importer(specifier)) as Record<string, unknown>;
    for (const candidate of [mod.default, mod.plugin]) {
      const attach = (candidate as { attachSandbox?: unknown } | undefined)?.attachSandbox;
      if (typeof attach === 'function') attach.call(candidate, sandbox.run);
    }
    return mod;
  };
}

export interface BuiltApp {
  app: FastifyInstance;
  db: Db;
  plugins: LoadedPlugin[];
  runner: JobRunner;
  documents: DocumentRepository;
  store: IngestStore;
}

export interface BuildOptions {
  config: Config;
  importer?: PluginImporter;
  /** Defaults to the deterministic MockAgent. Tests inject their own. */
  agent?: Agent;
}

export async function buildApp({ config, importer, agent }: BuildOptions): Promise<BuiltApp> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // Browsers' fetch wrappers often send `content-type: application/json` with NO body (e.g. a
  // bare POST /align). Fastify's default parser rejects that with a bare 400, so treat an empty
  // body as `{}`. Malformed JSON is still a 400, now with the usual error shape.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(
        Object.assign(new Error('Request body is not valid JSON'), {
          statusCode: 400,
          code: 'bad_json',
        }),
        undefined,
      );
    }
  });

  const db = openDb(config.DATABASE_PATH);
  app.addHook('onClose', async () => {
    db.close();
  });

  const logger: Logger = {
    debug: () => undefined,
    info: (message, extra) => console.log(`[gyan] ${message}`, extra ? JSON.stringify(extra) : ''),
    warn: (message, extra) => console.warn(`[gyan] ${message}`, extra ? JSON.stringify(extra) : ''),
    error: (message, extra) =>
      console.error(`[gyan] ${message}`, extra ? JSON.stringify(extra) : ''),
  };
  const ctx = {
    db,
    config,
    llm: createLLMProvider(config),
    embeddings: createEmbeddingProvider(config),
    vector: new InMemoryVectorIndex(),
    retrieve: placeholderRetrieval,
    ground: placeholderGrounding,
    logger,
  };

  // Laptop B's sandbox wiring (kept) on top of the frozen PluginContext and registry.
  const sandbox = createSandbox({ mode: config.SANDBOX_MODE, log: (m, e) => logger.info(m, e) });
  const registry = new PluginRegistry();
  const plugins = await loadPlugins(
    app,
    ctx,
    config.plugins,
    registry,
    withSandbox(importer ?? ((s) => import(s)), sandbox),
  );

  // Ingestion: a job left running by a crash can never finish, so fail it on startup.
  const documents = new DocumentRepository(db);
  const store = new IngestStore(db);
  const jobs = new JobRepository(db);
  jobs.failInterrupted();
  const bus = new ProgressBus();
  const runner = new JobRunner(jobs, bus);
  await registerIngestRoutes(app, {
    ingest: { documents, store, runner, llm: ctx.llm, embeddings: ctx.embeddings },
    bus,
    jobs,
  });

  // Contract routes (docs/API.md). Stubs read what `pnpm seed` loaded and validate every response.
  registerCourseRoutes(app, db);
  registerAlignmentRoutes(app, db, runner, { edgeMinConfidence: config.EDGE_MIN_CONFIDENCE });
  registerDocumentRoutes(app, db);
  // Chat: the contract stub keeps GET /chat/examples; POST /chat is the Study Agent (Laptop B).
  registerChatRoutes(app, db, { post: false });
  await registerStudyChatRoute(app, db, {
    agent: agent ?? createAgent(config, (m) => logger.info(m)),
    source: createChunkSource(db),
    maxToolCalls: config.MAX_TOOL_CALLS,
    log: (m, e) => logger.info(m, e),
  });

  app.get('/api/health', async () => ({
    ok: true,
    llmProvider: ctx.llm.id,
    embeddingsProvider: ctx.embeddings.id,
    plugins: plugins.map((p) => p.id),
  }));

  // Redacted view of effective config, handy for the Settings page.
  app.get('/api/config', async () => redactConfig(config));

  return { app, db, plugins, runner, documents, store };
}
