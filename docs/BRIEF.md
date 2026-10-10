ROLE

You are a senior full-stack engineer and AI systems architect building Gyan Setu, a working product, from first commit to last, for the Cline AI Builder Hackathon (Round 2). The goal is a real AI-powered solution to a real Indian student problem, built in about 8 hours, that a real person could use tomorrow. Cline is used both to build it and (bonus) inside the product.

First action: save this entire brief verbatim to docs/BRIEF.md so it survives context resets.

0. HOW TO WORK
Start in Plan mode. Read this whole brief, then reply with: (a) a short implementation plan, (b) the final repo tree, (c) at most 3 questions, only if truly blocking. Then proceed.
Build phase by phase (Section 12). After each phase: install, typecheck, lint, run tests, start the app, fix every error, then git commit with a conventional message (feat:, fix:, docs:, test:). Commit small and often. Never leave the repo broken.
Do not guess APIs. Before writing any Cline SDK code, read the official docs at docs.cline.bot/sdk and install the SDK skill if the docs say how. If the real API, package name or commands differ from this brief, follow the docs and record the difference in docs/CLINE_USAGE.md.
If a phase risks overrunning, ship the smallest working version and log what was cut in docs/ROADMAP.md. Use the cut order in Section 13.
No leftover TODO in a finished phase. No fake data presented as real. Prefer clear code over clever code.
Keep a running log in docs/CLINE_USAGE.md of how Cline was used (prompts, what it generated, what was fixed). It feeds the README and the presentation.
Thresholds, weights and model names in this brief are starting values. Put them in config, never hard-code them, and tune them with the eval harness.
1. PRODUCT

One-liner: Professors teach from slides and handwritten notes. Textbooks teach from chapters. Nobody connects the two. Gyan Setu does, continuously, across the whole semester.

Problem: Students get slides and notes but are told to study from several 400 to 500 page books. They cannot tell which pages match which lecture, what the professor emphasised, what is only in the notes, what the book covers that the professor skipped, or where the professor's notation and the book's disagree.

Hero feature: the Alignment Engine. For every slide or handwritten page (a "lecture unit"), find matching book sections and pages across all uploaded books and classify the relationship:

covers: same material. Read these pages.
extends: the book goes deeper or wider.
conflicts: the professor's definition, notation, sign convention, formula or scope differs from the book's.
professor_only: taught by the professor, found in no uploaded book (a flag).
book_only: in the book, never touched by a lecture (a flag, lower exam priority).

Everything else (chat, verifier, conflicts, problem finder, repair, prerequisites, tracker, diagnosis) is a feature plugin built on the alignment map.

Primary user: an undergraduate with slides, handwritten notes and several textbooks, using it all semester.

2. NON-NEGOTIABLE PRINCIPLES
Alignment is the product. Invest in its quality and visibility.
The LLM never receives whole books. It only sees retrieved chunks labelled with chunk_id.
The LLM cites chunk IDs only. Page numbers and document names are resolved from the database by code. The model never writes a page number.
Every quote is verified in code against the cited chunk (fuzzy match, configurable minimum, default 90%).
Abstain by default. If retrieval is weak, say "not found in your uploaded material" without asking the LLM to answer.
Confidence is computed from signals, not taken from the LLM's own number.
Numbers come from code. Any numeric result must come from run_verification, never LLM arithmetic.
Flag, don't rule. Conflicts and corrections are evidence-backed flags ("the book says X on p.41, your professor wrote Y"), never final verdicts.
Human in the loop. The student can confirm, reject or remap any edge in one click. Confirmed edges override model output and become few-shot examples for that course. Rejected edges become negative examples.
Always-working demo. A Mock provider and MockAgent make the whole UI work with no API keys, using deterministic sample data.
Privacy and copyright. Local-first storage (SQLite plus files). Data goes only to the configured model provider. Never redistribute book text: show only short snippets (max 20 words per quote) and page references. Never download copyrighted books. Use open textbooks for samples.
Modular. Adding a feature must not require touching the core.
Low confidence is shown, never hidden.
3. TECH STACK
Runtime: Node.js 22+, TypeScript (strict), pnpm workspaces monorepo.
Server (apps/server): Fastify, zod, better-sqlite3 (or Drizzle with SQLite), pino, @fastify/multipart, @fastify/cors, Server-Sent Events for streaming and progress.
Web (apps/web): React, Vite, TypeScript, Tailwind, React Router, TanStack Query, react-pdf / pdfjs-dist.
Core (packages/core): shared types, ingestion, retrieval, alignment, grounding, provider interfaces, plugin contracts. No HTTP code.
Features (packages/features/*): one package per plugin.
PDF text: pdfjs-dist per page. Detect scanned, garbled and formula-heavy pages and fall back to vision.
LLM access: an LLMProvider interface with chat, chatJson<T>(zodSchema), vision, embed. Implement AnthropicProvider, OpenAIProvider, MockProvider, selected by LLM_PROVIDER.
Embeddings: default to a local model via @xenova/transformers (no key, no cost). Optional hosted embeddings through the provider interface.
Vector search: embeddings stored as SQLite BLOBs, in-memory cosine similarity, behind a VectorIndex interface so sqlite-vec can replace it.
Keyword search: BM25 over chunk text plus context header.
Reranker: a Reranker interface with an LLM implementation (default) and an optional local cross-encoder.
Agent runtime: @cline/sdk inside apps/server/src/agent (verify against the docs, see Section 0).
Testing: vitest. Lint/format: eslint, prettier. CI: GitHub Actions running typecheck, lint, test, eval.
4. REPOSITORY LAYOUT
gyan-setu/
  apps/
    server/src/
      index.ts  config.ts
      db/              schema, migrations, repositories
      routes/          courses, documents, alignment, jobs, chat
      jobs/            ingestion + alignment runner with SSE progress
      agent/           Cline SDK agents, prompts/
      sandbox/         isolated code runner
      plugins/loader.ts
    web/src/
      pages/           Courses, Upload, AlignmentMap, Viewer, Coverage, Chat, Settings
      components/  features/ (panel registry)  lib/
  packages/
    core/src/
      types.ts  plugin.ts  vector.ts
      providers/       llm, anthropic, openai, mock, embeddings, reranker
      ingest/          pdf, quality, offsets, chunker, headers, exercises,
                       handwriting, adapters/
      retrieve/        query-builder, hierarchy, hybrid, rerank, neighbours
      ground/          cite, quote-verify, answer-validate, abstain,
                       confidence, claim-check
      align/           candidates, judge, relations, coverage, feedback
    features/
      study-agent  verifier  conflicts  problem-finder  handwriting-repair
      prerequisites  semester-tracker  mistake-diagnosis
  eval/    labeled.example.csv  unanswerable.example.csv  run.ts
  samples/README.md
  docs/    BRIEF ARCHITECTURE CLINE_USAGE ADDING_A_FEATURE EVAL DEMO_SCRIPT ROADMAP
  .env.example  README.md
5. DATA MODEL (SQLite, with migrations)
courses(id, name, created_at)
documents(id, course_id, kind, title, path, level, meta_json, status, extraction_quality). kind is book | slides | handwritten | past_paper | syllabus | text_note. level is intro | standard | advanced.
pages(id, document_id, pdf_page, printed_page, text, image_path, ocr_confidence, is_scanned, garbled_score, reextracted)
book_chunks(id, document_id, parent_id, prev_id, next_id, chapter, section, pdf_page_start, pdf_page_end, printed_page_start, printed_page_end, chunk_type, text, context_header, embedding). chunk_type is text | definition | example | exercise | solution | formula.
section_summaries(id, document_id, chapter, section, summary, embedding)
lecture_units(id, document_id, unit_no, title, text, image_path, transcription_json, embedding, query_text). transcription_json holds per-line text, confidence, uncertain spans.
alignment_edges(id, unit_id, chunk_id, relation, confidence, signals_json, rationale, evidence_unit, evidence_book, quote_verified, claim_verdict, conflict_type, user_status, created_at). relation is covers | extends | conflicts. claim_verdict is yes | partial | no | n/a. user_status is none | confirmed | rejected | remapped.
unit_flags(id, unit_id, flag) for professor_only. chunk_flags(id, chunk_id, flag) for book_only. Recomputed after alignment.
exercises(id, document_id, chunk_id, number, text, solution_text, printed_page, difficulty, level, topic_tags, has_solution, verifiable)
exercise_matches(id, exercise_id, unit_id, route, score, signals_json, rationale, user_status)
exercise_progress(id, exercise_id, status, attempts, last_attempt_at, notes). status is not_started | attempted | solved | struggled.
concepts(id, book_id, name, chunk_id) and concept_deps(concept_id, depends_on_id, confidence)
jobs(id, type, status, progress, error, created_at)
feedback(id, edge_id, action, created_at)
chat_sessions, chat_messages (store tool calls, citations, and citation_status per citation)
verifications(id, exercise_id, script, status, expected, got, created_at)
llm_cache(hash, response, tokens, created_at) and usage_log(provider, model, tokens_in, tokens_out, cost, created_at)

Add indexes on foreign keys and on (course_id, kind).

6. PLUGIN SYSTEM

Define in packages/core/src/plugin.ts:

ts
export interface FeaturePlugin {
  id: string; name: string; version: string;
  requires?: string[];
  register(ctx: PluginContext): void | Promise<void>;
}
export interface PluginContext {
  db: Db; llm: LLMProvider; vector: VectorIndex;
  retrieve: RetrievalService;   // grounded hybrid retrieval, available to every plugin
  ground: GroundingService;     // citation, quote and claim validators
  logger: Logger; config: Config;
  addRoutes(prefix: string, fn: (app: FastifyInstance) => void): void;
  addAgentTool(tool: AgentToolDefinition): void;
  addUiPanel(panel: UiPanelManifest): void;
  addJobHandler(type: string, handler: JobHandler): void;
  on(event: PluginEvent, handler: (payload: unknown) => void): void; // alignment.completed, edge.updated
}
export interface UiPanelManifest {
  id: string; title: string; icon: string;
  mount: "course" | "unit" | "chunk" | "chat";
  componentPath: string;
}

Rules:

Plugins load from the PLUGINS env list. Disabling one removes its routes, tools and panels without breaking the core.
The web app has a panel registry that renders plugin panels in the right slot.
Write docs/ADDING_A_FEATURE.md: a 5-step guide (create package, implement plugin, register routes/tools/panel, add tests, add to PLUGINS) with a minimal working example.
7. INGESTION (quality-first)

Run ingestion as background jobs with progress over SSE. Cache expensive steps by content hash.

Extract text per page with pdfjs-dist.
Quality gate per page. Compute garbled_score (dictionary-word ratio, odd-symbol ratio, average word length). Scanned pages (very little text) go to vision OCR. Garbled pages are re-extracted with vision. Formula-heavy pages (many math symbols, short lines) get vision or LaTeX-aware extraction. Set reextracted when repaired.
Page offsets. PDF page 57 is often printed page 41. Detect printed numbers from headers and footers, fit an offset per section, store both pdf_page and printed_page. The UI cites the printed page.
Structure. Use the PDF outline if present, else heuristics plus an LLM pass on the first 20 pages.
Structure-aware chunking. Chunk along chapter, section and block type, about 200 to 400 tokens. Never split a definition, worked example or formula from its explanation. Keep parent_id, prev_id, next_id.
Chunk typing via patterns plus LLM assist.
Context header. Before embedding and BM25 indexing, prepend Book > Chapter > Section [type]. Keep the stored display text clean.
Section summaries with embeddings, for coarse retrieval.
Exercises. Extract number, text, solution if present, printed page, and an estimated difficulty (position, length, concepts, book markers).
Embed all chunks, units and summaries.
Extraction quality. Score per page and per document, shown in the UI. Low-quality pages are marked and capped in confidence.

Slides: PDF required, PPTX optional text extraction. One lecture_unit per slide with title, text, optional image.

Handwritten notes: images and PDFs. The vision provider transcribes to JSON per line with text, confidence, uncertain. Split into units by topic or page. Keep the original image.

Past papers and syllabus: stored for later features.

Multiple books per course with a level field.

8. RETRIEVAL (RAG)

Pipeline in packages/core/src/retrieve/, used by alignment, chat and plugins:

Query builder: build the query from the unit's title, body and the previous/next units. For chat, rewrite follow-ups into standalone questions first.
Multi-query: generate 2 to 3 phrasings, including the professor's notation and the textbook's.
Coarse: match against section_summaries to find top sections.
Fine hybrid: inside those sections, combine embedding cosine and BM25 using reciprocal rank fusion, retrieving RETRIEVE_TOP_K (default 25). If the coarse score is low, fall back to global hybrid search.
Rerank down to RERANK_TOP_K (default 8) with the Reranker.
Expand with neighbour (prev/next) and parent chunks.
Course boost: small score boost for chunks matched by confirmed edges.
Abstain gate: if the best score is below RETRIEVAL_MIN_SCORE, return NOT_FOUND and do not call the LLM for an answer.

Chunks are given to the LLM labelled [C<id>].

9. ALIGNMENT AND GROUNDING
9.1 Judge

For each unit, run the LLM judge at temperature 0 with a strict zod schema, quote-first:

ts
{
  quotes: { chunk_id, quote }[],          // max 20 words each
  best_matches: { chunk_id, relation }[], // covers | extends | conflicts
  rationale: string,                      // max 2 sentences
  evidence_unit: string,                  // max 20 words
  evidence_book: string,                  // max 20 words
  conflict_type?: 'notation'|'definition'|'sign_convention'|'formula'|'scope',
  professor_only?: boolean
}

The model returns no page numbers and no confidence number. Code produces both.

Run the judge twice, the second time with candidates in a different order, and record whether both runs agree.

Inject confirmed and remapped edges for the course as few-shot examples; exclude rejected edges for that unit.

After all units: mark units with no confident edge professor_only; mark chunks and sections with no confident edge book_only.

Batch, retry with exponential backoff, rate-limit, cache by hash, log token usage.

9.2 Grounding layer (ground/)

Every model output passes through these checks before storage or display:

Module	Check	On failure
cite.ts	Cited chunk_id exists and was in the retrieved set	Drop the citation
quote-verify.ts	evidence_book and evidence_unit fuzzy-match their source text (min QUOTE_MATCH_MIN)	Drop the edge or cut confidence
answer-validate.ts	Every [Doc, p.N] in a chat answer maps to a chunk returned by a tool call this turn	Strip it and mark "unverified citation"
abstain.ts	Retrieval score above threshold	Answer "not found in your material"
claim-check.ts	Second pass: does the snippet support this conflict or correction claim (yes/partial/no)?	Show only yes, mark partial, hide no
confidence.ts	Computes confidence (below)	n/a

Any number in a chat answer must trace to a run_verification result, otherwise flag it "unverified calculation".

9.3 Computed confidence

Blend these signals (weights in config, tune with eval): retrieval score after rerank (about 0.30), quote verified (about 0.25), judge agreement across the two runs (about 0.20), gap between top-1 and top-2 (about 0.10), source extraction quality (about 0.10), LLM self-report (about 0.05).

Hard caps: quote not verified, max 0.4. Judge runs disagree, max 0.5. Low-quality source page, max 0.5.

Store all signals in signals_json so the "Why this match?" popover can show them.

9.4 Coverage (align/coverage.ts)

Count an edge only if it is confident (above a configurable threshold), not rejected, and quote-verified. Confirmed edges always count. Per book and chapter compute:

matched pages, and coverage % = matched pages / total pages in the chapter
counts of professor_only units, book_only sections, conflicts, and low-confidence edges

Also compute a minimal reading path per unit: the smallest page set, sorted by confidence. Document clearly in the UI that coverage measures how much a book was touched by lectures, not how important a chapter is.

9.5 Eval harness (eval/run.ts)

Read eval/labeled.csv (columns unit_text_or_id, correct_book, correct_page_start, correct_page_end) and eval/unanswerable.csv. Print and write to docs/EVAL.md:

alignment accuracy@1 and accuracy@3
retrieval recall@8
citation validity (target 100%)
quote-match rate
correct-abstention rate on unanswerable questions
mean confidence and calibration (confidence buckets vs accuracy)
Problem Finder precision@5, if labels exist

CI runs the eval on the synthetic sample and fails if citation validity is below 100% or other metrics regress beyond a tolerance.

10. CLINE SDK AGENTS (apps/server/src/agent)

Read the Cline SDK docs first (Section 0). Implement A and B (mandatory), C only after Phases 1 to 5 are stable.

A. Study Agent

A Cline SDK agent served over SSE that answers questions by calling tools over the alignment map:

search_notes(query, course_id)
get_book_section(book_id, page_start, page_end) (trimmed, with printed pages)
get_alignment(unit_id)
get_conflicts(topic_or_unit_id)
get_prerequisites(topic)
find_exercises(topic) (uses the Problem Finder matching)
run_verification(exercise_id | problem_text, proposed_answer)

Flow: rewrite the question, abstain check, tool loop (max MAX_TOOL_CALLS, per-call timeouts), quote-first drafting, answer-validate, stream with tool events and a token counter.

System prompt, stored in agent/prompts/study.md:

You are Gyan Setu's study agent. You help a student understand their course using ONLY the
tools provided. Never answer from memory when a tool can supply the source.
1. Cite sources as [Document, p.N] using the printed pages the tools return. If the tools
   return nothing relevant, say so plainly.
2. When the professor's material and the book disagree, present both with citations and say
   the exam should follow the professor's version unless the student says otherwise.
3. For any numerical or coding result, call run_verification first. Never do mental arithmetic.
   If verification fails or mismatches, say so and show the discrepancy.
4. First extract the relevant quotes from tool results, then answer only from those quotes.
5. Prefer the smallest sufficient reading: specific pages, not whole chapters.
6. Be concise. Explain step by step only when asked or when the topic is difficult.
7. Never invent page numbers, quotes or exercise numbers.

UI shows visible tool events (for example "Looked up pages 41-48") and clickable citation chips that open the Viewer at the cited page.

Fallback: MockAgent returns deterministic cited answers from sample data if the SDK fails or no key is set.

B. Verifier and sandbox

For numerical or coding problems, an agent step writes a short script that independently computes the answer, runs it in the sandbox, and returns {status: "verified"|"mismatch"|"error", expected, got, script, stdout}. The UI shows "Verified by running code" or a mismatch diff.

Sandbox rules (apps/server/src/sandbox):

Fresh temp directory, never the repo.
Hard timeout (10 s), output cap (10 KB), stripped environment variables, no secrets.
If Docker is available use docker run --network none with CPU and memory limits; otherwise run a local subprocess and log a clear warning that network isolation is not enforced.
Allow-list interpreters (python3, node).
C. Textbook Adapter Agent (stretch)

For unusual layouts, an agent reads sample pages, writes a parser adapter into packages/core/src/ingest/adapters/, tests it, and proposes it for explicit user approval before loading.

11. FEATURE PLUGINS
study-agent: chat UI, citation chips, tool events, token counter.
verifier: verification badge in chat and on exercises.
conflicts: course-wide list of conflicts with type, both snippets and citations, a "follow the professor's version" note, filter by type, export as one-page PDF or Markdown. Only claim-check yes verdicts are shown as conflicts.
problem-finder: suggests book exercises matched to slides and notes.
Two routes merged: (1) inherit exercises from book sections with confident edges to the unit; (2) direct hybrid search of each exercise embedding against the unit query.
Score blends alignment confidence, direct similarity, concept overlap, level fit, section proximity. Remove rejected matches.
Show exercise number, book and printed page, a quote-verified reason, difficulty, whether a solution exists, whether it can be verified by code.
Practice set builder: "6 problems on this week's lectures in 45 minutes", ordered easy to hard.
Warn when a problem uses the book's notation where the professor's differs.
Progress tracking (exercise_progress); attempted problems link to Mistake Diagnosis; repeated struggle suggests the Prerequisite Gap Finder.
Grounded: exercise numbers and pages come from the DB; the model only chooses among retrieved exercise IDs; abstain with "no matching book problems found" when scores are low.
Routes under /api/features/problem-finder/: GET /unit/:id/suggestions, GET /course/:id/suggestions, POST /course/:id/practice-set, PATCH /exercise/:id/progress, PATCH /matches/:id.
Registers panels at mount: "unit" and mount: "course"; replaces the implementation behind the Study Agent's find_exercises; listens to alignment.completed and edge.updated.
handwriting-repair ("book as dictionary"): after a handwritten unit is aligned, build a vocabulary and symbol list from its aligned chunks, then run a second-pass LLM correction restricted to uncertain spans. Show a before/after diff with per-correction confidence. Never change text silently: corrections are suggestions the student accepts or rejects.
prerequisites: build a concept dependency graph per book (TOC order plus LLM extraction of "depends on" with confidence). Given a struggling topic, trace back to prerequisites with page references and a "read this first" path.
semester-tracker: student pastes a syllabus; show what lectures cover, which chapters are now in scope, pace versus plan, and a reading budget ("read these 14 pages, not 80").
mistake-diagnosis ("Explain My Mistake"): photo of an attempt; vision transcribes the steps; compare with the verified solution; find the first step where reasoning diverges; name the likely misconception; propose 3 practice problems from the same section. Present as a diagnosis with a confidence level.

Stretch (Phase 9, only after Phases 1 to 8 are stable, documented and committed): Textbook Adapter Agent; Professor Style Fingerprint (past papers only, framed as understanding the course, never predicting or leaking exam content); Mother-Tongue Bridge (explanations in a chosen Indian language, technical terms kept in English); Class Confusion Heatmap (anonymous aggregate, clearly labelled sample data in the demo, never individual student data); a time-budgeted Readiness Plan.

12. BUILD PHASES (strict order, commit after each)

Phase 0 (about 45 min): Scaffold and safety net. Monorepo, TS config, lint, vitest, CI, Fastify and Vite apps, .env.example, LLMProvider with MockProvider, plugin loader skeleton, health check, SQLite migrations, panel registry skeleton, empty retrieve/ and ground/ modules with interfaces. Write docs/BRIEF.md, docs/ROADMAP.md, docs/CLINE_USAGE.md. Acceptance: pnpm dev runs both apps, pnpm test passes, mock mode serves sample data.

Phase 1a (about 60 min): Ingestion. Section 7 in full, with the synthetic sample. Acceptance: a sample book yields typed, headed, linked chunks with printed pages and an extraction quality score.

Phase 1b (about 90 min): Retrieval, alignment, grounding and UI. Sections 8, 9.1 to 9.4, plus the screens: Courses, Upload with progress, Alignment Map (unit tree left, matched sections right, relation badges, confidence bar, filters, confirm/reject/remap), Side-by-side Viewer (with evidence highlight and "Why this match?" popover showing signals), Coverage dashboard. Acceptance: with sample data the map renders, edges can be corrected, coverage numbers are correct, abstention works.

Phase 1c (about 20 min): Eval harness and CI gate (Section 9.5), plus a seed script. Acceptance: pnpm eval prints all metrics and writes docs/EVAL.md.

Phase 2 (about 45 min): Study Agent. Section 10-A, chat UI, citation chips, tool events, MockAgent. Acceptance: "Why does my professor's formula differ from the book's?" triggers tool calls and returns a validated, cited answer; an unmatched citation is shown as unverified in a test.

Phase 3 (about 30 min): Verifier. Section 10-B, sandbox, badge. Tests for timeout, output cap and mismatch. Acceptance: a deliberately wrong solution is caught and shown as a mismatch.

Phase 4 (about 25 min): Conflict Detector. With claim-check. Acceptance: sample data shows at least 3 conflicts with evidence on both sides.

Phase 5 (about 30 min): Problem Finder. Section 11. Acceptance: a sample slide returns matched exercises with real numbers and printed pages; a topic with no exercises abstains.

Phase 6 (about 30 min): Handwriting Repair. Acceptance: a messy sample page shows measurably fewer uncertain spans after repair, with a before/after diff.

Phase 7 (about 25 min): Prerequisite Gap Finder. Acceptance: a sample topic returns a chain of at least 2 prerequisites with pages.

Phase 8 (about 40 min): Semester Tracker and Mistake Diagnosis.

Final (about 40 min): Docs and demo. README, ARCHITECTURE, ADDING_A_FEATURE, EVAL, DEMO_SCRIPT, ROADMAP, screenshots placeholders.

Phase 9: stretch only (Section 11).

13. CUT ORDER IF BEHIND SCHEDULE

Drop in this order and log each in docs/ROADMAP.md: (1) Phase 9 stretch, (2) Mistake Diagnosis, (3) Semester Tracker, (4) Prerequisite Gap Finder, (5) local cross-encoder reranker, (6) second judge pass (cap confidence lower), (7) multi-query expansion, (8) per-span editing in Handwriting Repair.

Never cut: chunk-ID citations, quote verification, abstain gate, MockProvider, Alignment Map, CI gate.

14. API (Fastify, all validated with zod)
POST /api/courses                  GET /api/courses[/:id]
POST /api/courses/:id/documents    (multipart, kind field)
GET  /api/jobs/:id/events          (SSE progress)
POST /api/courses/:id/align
GET  /api/courses/:id/alignment    (units, edges, flags, filters)
PATCH /api/edges/:id               (confirm | reject | remap)
GET  /api/courses/:id/coverage
GET  /api/units/:id                GET /api/documents/:id/pages/:n
GET  /api/documents/:id/quality    (extraction quality per page)
GET  /api/edges/:id/signals        (confidence breakdown)
POST /api/courses/:id/chat         (SSE from the Study Agent, rate-limited)
/api/features/<plugin-id>/...      (plugin routes)
15. FRONTEND REQUIREMENTS
Clean, calm, student-friendly; responsive (phone and laptop); accessible (keyboard navigation, labels, contrast).
Every list has loading, empty and error states. Long operations show progress.
Citations are clickable chips that open the Viewer at the exact page, showing printed page numbers.
Confidence is a small bar plus a number; low confidence is visually distinct.
Unverified citations and unverified calculations are visibly marked.
Extraction quality is visible per document and page.
Settings: provider status, mock toggle, enabled plugins, token and cost usage.
First-run demo mode loads the sample course so a judge can click through immediately.
16. CONFIG (.env.example)
LLM_PROVIDER=mock            # mock | anthropic | openai
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
EMBEDDINGS=local             # local | openai
RERANKER=llm                 # llm | cross-encoder | none
CHAT_MODEL=
VISION_MODEL=
CLINE_AGENT_MODEL=
LLM_TEMPERATURE=0
PLUGINS=study-agent,verifier,conflicts,problem-finder,handwriting-repair,prerequisites,semester-tracker,mistake-diagnosis
DATA_DIR=./data
SANDBOX_MODE=auto            # auto | docker | local
MAX_TOOL_CALLS=8
RETRIEVAL_MIN_SCORE=0.35     # abstain threshold, tune with eval
QUOTE_MATCH_MIN=0.90
RETRIEVE_TOP_K=25
RERANK_TOP_K=8
EDGE_MIN_CONFIDENCE=0.5      # for coverage and flags

Validate with zod on startup and fail with a clear message. Never log secrets.

17. SAMPLES, TESTS, SECURITY
samples/README.md: how to add sample data. Use open textbooks (OpenStax, NPTEL) and the team's own lecture material with permission. Do not commit copyrighted books.
Include a tiny synthetic sample (a few pages of generated text with a known alignment key, known conflicts, and a few exercises) so tests, mock mode and CI work offline.
Tests (vitest): chunker, exercise detection, page offset mapping, garbled detection, hybrid retrieval, rerank, abstain gate, quote verify, citation validation, confidence caps, judge schema validation, coverage aggregation, problem-finder scoring, plugin loader (enable/disable), sandbox (timeout, output cap), API validation.
Security: validate uploads (type and size limits), sanitize filenames, never execute uploaded content, keep the sandbox isolated, rate-limit the chat endpoint, escape all rendered text.
18. DOCUMENTATION DELIVERABLES
README.md: problem, solution, architecture diagram, tech stack, setup (mock mode and real mode), screenshot placeholders, and a "How Cline was used" section in two parts: in the build and inside the product (Study Agent, Verifier, Adapter).
docs/ARCHITECTURE.md: Mermaid diagram of ingestion, retrieval, alignment, grounding, plugins and agents.
docs/CLINE_USAGE.md, ADDING_A_FEATURE.md, EVAL.md, ROADMAP.md.
docs/DEMO_SCRIPT.md: a 3-minute walkthrough with a real student scenario, ending with the eval numbers.
19. DEFINITION OF DONE
A student can create a course, upload a book, a slides PDF and a handwritten-notes image, and see the Alignment Map with all five relation types, confidence, and one-click correction.
Coverage numbers are correct on the sample course.
The Study Agent (Cline SDK) answers a cross-source question with validated citations and visible tool calls.
The Verifier catches a deliberately wrong numerical solution.
The Conflict Detector shows at least 3 evidence-backed conflicts.
Problem Finder returns matched exercises with real numbers and pages.
Handwriting Repair shows a before/after diff.
Mock mode runs everything with no keys.
pnpm test passes, CI is green, the README and docs are complete, and the commit history tells the story of the build.
20. FIRST MESSAGE BACK TO ME

Reply with the plan, the repo tree, and up to 3 blocking questions. Then begin Phase 0.