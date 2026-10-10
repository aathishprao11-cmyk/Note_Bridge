# Contract requests

Use this file when you need a change in a file the other laptop owns (see `docs/TEAM.md`).
Add a new entry at the top of "Open". The owner replies in the entry and moves it to "Done".

Entry format:

```
### <short title> (from Laptop A|B, YYYY-MM-DD)
- File(s): <path>
- Change wanted: <what and why>
- Status: open | done | declined (<reason>)
```

## Open

### Manual transcript for offline handwritten uploads (from Laptop B, 2026-10-10)

- File(s): `packages/core/src/api-contract.ts`, `packages/core/src/ingest/*`,
  `apps/server/src/routes/ingest.ts`, `apps/server/src/jobs/*`,
  `apps/server/src/db/repositories/ingest-store.ts` (all Laptop A / shared)
- Change wanted: with no vision provider, "Handwritten notes" could never work (mock vision returns
  `[mock-vision:...]`, no PDF page renderer is wired). Added an optional `transcript` upload field
  (handwritten kind only): the server validates the file, splits the text on `---PAGE---` against the
  real page count, and indexes it with no OCR call. `pages.text` now stores it, and the ingestion
  cache hash includes the transcript so a corrected version re-ingests. The upload route returns
  `transcript_required` (400) instead of ingesting mock text. This implements part of BRIEF 10-B
  handoff (repair-and-reingest); a real `vision()` provider can replace the manual path later.
- Status: done (landed with Laptop B's fix commit; please review)

### FYI for Laptop B: contract freeze (from Laptop A, 2026-10-10)

Breaking changes for anything already written against Phase 0 / 1a:

- `Document.role` is now `Document.kind` (`book | slides | handwritten | past_paper | syllabus |
text_note`). Upload field `role` is now `kind`; `notes` is now `handwritten`.
- Relation `same` is now `covers`. Edges are now `AlignmentEdge` (unit -> chunk, with `signals`,
  evidence quotes, `claimVerdict`, `conflictType`, `userStatus`), not section -> section.
- `GyanPlugin` is now `FeaturePlugin`; `PluginContext` matches BRIEF Section 6 (`db`, `llm`,
  `embeddings`, `vector`, `retrieve`, `ground`, `logger`, `config`, `addRoutes`, `addAgentTool`,
  `addUiPanel`, `addJobHandler`, `on`). A plugin's `register(ctx)` calls `ctx.addRoutes(...)`
  instead of returning routes. Routes mount at `/api/features/<id>/...` (was `/api/plugins/<id>`).
  `ctx.retrieve` currently always abstains and `ctx.ground` does only model-free checks (honest
  placeholders until Phase 1b).
- Shared files touched: `packages/core/src/types.ts`, `plugin.ts`, `api-contract.ts` (new),
  `packages/core/package.json` (fastify dev dependency for plugin types), `pnpm-lock.yaml`.
  Run `pnpm install` after pulling.
- To build screens: `pnpm seed`, then see "Building against the frozen contract" in `TEAM.md`.
- Status: open (read and reply when seen)

### Schema reconciliation: brief Section 5 vs what existed (from Laptop A, 2026-10-10)

Migration `003_contract.sql` only adds; `001` and `002` are untouched. Conflicts found:

1. **`edges` vs `alignment_edges`.** The Phase 0 `edges` table linked sections to sections with
   relations `same/extends/conflicts/professor_only/book_only`. The brief's `alignment_edges` links a
   lecture unit to a chunk, has only `covers/extends/conflicts`, and stores professor_only/book_only
   as separate flag tables. Resolution: new `alignment_edges`, `unit_flags`, `chunk_flags`,
   `feedback`. Old `edges` is left in place, unused (SQLite cannot cleanly drop a table that other
   migrations reference; harmless).
2. **`documents.role` vs `kind`.** `role` has a NOT NULL CHECK (`book|slides|notes`) that cannot be
   relaxed without rebuilding the table. Resolution: new `kind` column is the source of truth;
   `role` stays as the ingestion pipeline's view (`handwritten` -> `notes`). Only the three
   ingestible kinds can be stored until a later migration rebuilds `documents`.
3. **`book_chunks` vs `chunks`.** The brief names the table `book_chunks` and has
   `chapter, section, pdf_page_start/end, printed_page_start/end, chunk_type, embedding`. We kept
   the name `chunks` (renaming churns Phase 1a code); chapter/section come from `sections` via
   `section_id`; added `pdf_page_end`, `printed_page_start`, `printed_page_end`; `kind` is the
   chunk type; embeddings stay in the `embeddings` table. **Differences:** chunk type `solution` is
   not stored (solutions live on `exercises`), and `formula` chunks are not yet produced by Phase 1a
   ingestion.
4. **`section_summaries` vs `sections.summary`.** Summary text stays on `sections`; its vector goes
   in new `section_embeddings`. Equivalent, different layout.
5. **`pages`** is new. Phase 1a stored per-page quality as JSON on `documents.page_quality`; both
   exist now. Phase 1a ingestion writes `pages` rows (without page text); the seed writes text.
   `ocr_confidence` and `reextracted` are only filled by the seed until vision re-extraction lands.
6. **`exercises`** gained `printed_page, difficulty, level, topic_tags, verifiable`. Brief columns
   named `number`, `text`, `solution_text` are kept as `label`, `statement`, `solution`.
   Phase 1a does not yet estimate `difficulty` (stays NULL), set `level`, or detect `verifiable`.
7. **`jobs`**: brief has `type`; we have `kind`. Same meaning, kept.
8. **Brief tables added with no logic yet:** `lecture_units`, `exercise_matches`,
   `exercise_progress`, `concepts`, `concept_deps`, `chat_sessions`, `chat_messages`,
   `verifications`, `llm_cache`, `usage_log`.
9. **Phase 1a does not yet create `lecture_units`.** Ingesting slides or notes creates sections
   and chunks, not units. Only the seeded demo has units. Needs a follow-up (Laptop A).

- Status: open (Laptop B: object here if a column name blocks you)

### Stub routes that are not live yet (from Laptop A, 2026-10-10)

`POST /align` (job does nothing), `GET /alignment`, `/edges/:id/signals`, `/units/:id` (read the
DB, so only the seeded course has data), `GET /coverage` (fixture numbers, not computed),
`POST /chat` (replays canned answers; Laptop B replaces it with the Study Agent in Phase 2).

- Status: open until Phase 1b / Phase 2

## Done

- Ownership of upload/job routes, `samples/`, and server wiring: now Laptop A (see `TEAM.md`).
- `docs/BRIEF.md` saved.

## Contract requests (from Laptop B ΓÇö Experience)

Change requests for the **shared** contract. Per `docs/TEAM.md`, Dev B does **not** edit core / db /
eval or the contract files (`packages/core/src/types.ts`, `docs/API.md`). Anything the Phase 1b
screens need from the shared surface is filed here for the contract owner instead.

Owner: Dev A (contract). Status: **open**. Raised during Phase 1b (screens).

### 1. `Coverage` type + `/coverage` response shape

**Why:** `docs/API.md` lists `GET /api/courses/:id/coverage` but its response is explicitly
"TBD in Phase 1b" (API.md line 27). The Coverage screen needs a stable shape.

**Current workaround (B-owned, temporary):** `apps/web/src/lib/types.ts` defines a local
`Coverage` view type, and `apps/web/src/lib/format.ts#computeCoverage` derives it from
`edges + sections + documents`. `getCoverage()` in `apps/web/src/lib/api.ts` currently returns this
derived value. This must be replaced by the real endpoint response when it lands.

**Requested contract shape** (proposed; please confirm or amend):

```ts
interface Coverage {
  courseId: string;
  /** Fraction (0..1) of professor units with a confirmed/remapped book section. */
  matchedRatio: number;
  /** Professor units with no confirmed book counterpart. */
  professorOnly: Section[];
  /** Book sections with no professor counterpart. */
  bookOnly: Section[];
}
```

Questions for the owner:

- Should `matchedRatio` count only `confirmed`/`remapped` edges (current assumption), or also
  `proposed` ones with non-null `bookSectionId`?
- Are `professorOnly` / `bookOnly` **sections** (current assumption) or ids?

### 2. `PUT /api/edges/:id` request body

**Why:** The Alignment Map confirms / rejects / remaps an edge. Please confirm the body.

**Assumed shape:**

```ts
interface UpdateEdgeBody {
  status: EdgeStatus; // 'proposed' | 'confirmed' | 'rejected' | 'remapped'
  bookSectionId?: string; // required when status === 'remapped'
}
```

Questions:

- Does `remapped` require `bookSectionId` (server should 422 otherwise)? Confirmed?
- Does `confirmed`/`rejected` ignore `bookSectionId` if sent?

### 3. `GET /api/courses/:id/sections` shape

**Assumption:** returns a **flat `Section[]`** where each item carries `documentId` + `parentId`
(the viewer builds the tree client-side via `parentId`). Please confirm it is flat and not
pre-nested. If nesting is planned, tell me the node shape and I will drop `buildSectionTree`.

### 4. `Section` has no `role` (used to classify book vs professor units)

**Observation:** `Section` carries `documentId` but not the document `role`, so the client must
join sections ΓåÆ documents to tell book sections from professor units (done in
`computeCoverage` and the Alignment Map remap list). This works, but if the owner prefers, a
denormalized `role` on `Section` (or including `role` in the `/sections` payload) would save a
second round-trip. Non-blocking.

### Notes

- Screens build against `packages/core/src/types.ts` (the shared contract; `api-contract.ts` is not
  present in this repo) and mock fixtures shaped to match it, because the REST endpoints and seed
  data are Dev A's Phase 1b/1c work. Toggling `VITE_USE_MOCK_API=false` switches the client to the
  real endpoints with no code change.

### Laptop B confirmation: ownership in TEAM.md

> Note: this section was written against the earlier Dev A / Dev B ownership table. `docs/TEAM.md`
> has since been replaced by the Laptop A / Laptop B version. In it, `sandbox/`, `verifier/` and
> `conflicts/` belong to Laptop B, and `problem-finder` and `handwriting-repair` belong to Laptop A
> (the reverse of the table below for those features). That version of `docs/TEAM.md` and
> `.github/CODEOWNERS` is the current source of truth; Laptop B has not yet re-confirmed it.

Status: **accepted, with the small additions below.** Raised by Laptop B (Dev B, Experience).

We accept the ownership table in `docs/TEAM.md` as written: Dev B owns `apps/web/`,
`apps/server/src/agent/` and the six B feature packages (`study-agent`, `problem-finder`,
`handwriting-repair`, `prerequisites`, `semester-tracker`, `mistake-diagnosis`). Dev A owns the
pipeline, backend routes, jobs, sandbox, `eval/`, `samples/` and the `verifier` / `conflicts`
packages. We also accept the phase split, the migration ranges (Dev B uses `200-299`) and the rule
that Dev B does not edit shared contract files directly.

Caveat: `docs/BRIEF.md` is still a placeholder, so we could not check this table against the brief's
own section numbers. This confirmation holds until the brief is pasted in; we will re-check then.

The following paths exist in the repo but have no owner in `TEAM.md` / `.github/CODEOWNERS`. Proposed
owners are suggestions for Dev A to confirm; none of these changes are made by Laptop B because they
touch shared files.

| Path                                                                                                                                                    | Problem                                                                                                  | Proposed                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `apps/server/src/{app,config,index,seed}.ts`, `apps/server/src/db/index.ts`                                                                             | Server bootstrap files are not in any row                                                                | Shared (both approve)                 |
| `apps/server/test/`, `packages/core/test/`                                                                                                              | Tests have no row                                                                                        | Follow the code they test             |
| `packages/core/src/index.ts`                                                                                                                            | Core barrel file is not listed; it re-exports contracts                                                  | Shared (both approve)                 |
| `docs/` except `API.md` (`BRIEF.md`, `ROADMAP.md`, `CLINE_USAGE.md`, `CONTRACT_REQUESTS.md`)                                                            | No owner                                                                                                 | Shared, or one owner per file         |
| Root config: `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `vitest.setup.ts`, `.prettierrc`, `.nvmrc`, `.env.example`, `pnpm-lock.yaml` | TEAM.md says "root config" is shared, but CODEOWNERS lists only `package.json` and `pnpm-workspace.yaml` | Add to the shared block in CODEOWNERS |
| `README.md`                                                                                                                                             | No owner                                                                                                 | Shared                                |

Things that look wrong or unclear:

1. **Chat endpoint split.** `POST /api/courses/:id/chat` (SSE) lives under `apps/server/src/routes/`
   (Dev A), but the agent behind it lives in `apps/server/src/agent/` (Dev B). Please confirm Dev B
   may add the chat route file inside `routes/`, or name a different location for the route.
2. **Seeding.** `pnpm seed` is Dev A's Phase 1c work, but `apps/server/src/seed.ts` is unowned. We
   propose Dev A owns it.
3. **Mock provider.** `packages/core/src/providers/` (including `mock.ts`) is Dev A's, but Dev B
   builds against `LLM_PROVIDER=mock`. Dev B will request changes to the mock by issue or PR comment
   rather than editing it.
4. **CODEOWNERS handles.** `@DEV_A_GITHUB` and `@DEV_B_GITHUB` are still placeholders, so no
   ownership is enforced yet.
5. **Paths that do not exist yet.** `packages/core/src/{ingest,align}`, `apps/server/src/{jobs,routes,sandbox,agent}`,
   `eval/`, `samples/` and every `packages/features/*` package are listed but not created. This is
   expected; it only means the table has not been tested against the real tree.
6. **Migrations.** CODEOWNERS makes both developers approve every change under `db/migrations/`,
   while TEAM.md gives each developer a numbering range. We suggest keeping both approvals for now;
   no change requested.
