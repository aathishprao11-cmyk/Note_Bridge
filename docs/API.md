# API contract (frozen, shared between Laptop A and Laptop B)

Source of truth: `packages/core/src/api-contract.ts` (zod schemas, plus a `ROUTES` table) and the
entity types in `packages/core/src/types.ts`, both exported from `@gyan/core`. This file is the
human summary. Changing either needs both laptops (see `docs/TEAM.md`).

**Status column:** `live` = real behaviour. `stub` = reads the seeded demo data (`pnpm seed`) and
returns contract-valid responses; the engine replaces the body later without changing the shape.

Every response is validated against its schema before it is sent; a drifting route returns
`500 contract_violation`. Errors are always `{ "error": { "code", "message" } }`.

## Routes (BRIEF Section 14)

| Method | Path                             | Body / query                                                           | Response                                                                          | Status                                           |
| ------ | -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| POST   | `/api/courses`                   | `{ name }`                                                             | 201 `Course`                                                                      | live                                             |
| GET    | `/api/courses`                   |                                                                        | `Course[]`                                                                        | live                                             |
| GET    | `/api/courses/:id`               |                                                                        | `Course`                                                                          | live                                             |
| POST   | `/api/courses/:id/documents`     | multipart: `kind`, optional `title`, `level`, `file`                   | 202 `{ documentId, jobId, cached }`                                               | live                                             |
| GET    | `/api/courses/:id/documents`     |                                                                        | `Document[]`                                                                      | live                                             |
| GET    | `/api/jobs/:id`                  |                                                                        | `{ jobId, kind, status, progress, message, documentId, error }`                   | live                                             |
| GET    | `/api/jobs/:id/events`           |                                                                        | SSE, each `data:` is a `JobProgress`                                              | live                                             |
| POST   | `/api/courses/:id/align`         | `{ documentIds? }`                                                     | 202 `{ jobId }`                                                                   | stub (job does nothing yet)                      |
| GET    | `/api/courses/:id/alignment`     | `relation, minConfidence, maxConfidence, userStatus, flag, documentId` | `{ courseId, units, edges, chunks, counts }`                                      | stub (reads DB)                                  |
| PATCH  | `/api/edges/:id`                 | `{action:'confirm'}`, `{action:'reject'}`, `{action:'remap', chunkId}` | `AlignmentEdge`                                                                   | live (persists + feedback)                       |
| GET    | `/api/edges/:id/signals`         |                                                                        | `{ edgeId, confidence, signals, weights, rationale, evidenceUnit, evidenceBook }` | stub (reads DB)                                  |
| GET    | `/api/courses/:id/coverage`      |                                                                        | `CoverageReport`                                                                  | stub (fixture numbers)                           |
| GET    | `/api/units/:id`                 |                                                                        | unit, edges, chunk refs, prev/next                                                | stub (reads DB)                                  |
| GET    | `/api/documents/:id/pages/:n`    | `n` = PDF page, 1-based                                                | page, chunks on it                                                                | live (reads DB)                                  |
| GET    | `/api/documents/:id/quality`     |                                                                        | per-page and per-document extraction quality                                      | live (reads DB)                                  |
| POST   | `/api/courses/:id/chat`          | `{ message, sessionId? }`                                              | SSE of `ChatEvent`                                                                | stub (replays canned answers; 20/min rate limit) |
| GET    | `/api/courses/:id/chat/examples` |                                                                        | canned conversations                                                              | stub                                             |
| any    | `/api/features/<plugin-id>/...`  |                                                                        | owned by each plugin                                                              | live (loader)                                    |
| GET    | `/api/health`, `/api/config`     |                                                                        | health, redacted config                                                           | live                                             |

`relation` accepts all five types: `covers`, `extends`, `conflicts` (edges) and `professor_only`,
`book_only` (flags: they filter units / chunks, not edges).

## Notes for the UI

- **Pages:** show `printedPage*`, never the PDF page, to the student. `printedPage` can be `null`
  when no printed number was found; fall back to the PDF page and say so.
- **Confidence:** a number 0..1 computed by code. `signals.capsApplied` lists hard caps that fired
  (`quote_not_verified` max 0.4, `judge_disagreement` max 0.5, `low_quality_source` max 0.5). Show
  low confidence, never hide it. `claimVerdict`: show `yes`, mark `partial`, hide `no`.
- **Citations:** `status: 'unverified'` must be visibly marked. `unverifiedCalculation: true` on a
  chat `done` event must be marked too.
- **Chat SSE events:** `session`, `text` (delta), `tool-started`, `tool-finished`, `usage`, `done`
  (final content, citations, `abstained`, computed `confidence`), `error`. Examples with every case:
  `GET /api/courses/:id/chat/examples`.
- **Upload `kind`:** `book`, `slides`, `handwritten` are ingested today. `past_paper`, `syllabus`,
  `text_note` return `422 kind_not_supported_yet`.
- **Coverage** measures how much a book was touched by lectures, not how important a chapter is.
  Say so in the UI (BRIEF 9.4).

## Error codes

`bad_request`, `bad_kind`, `kind_not_supported_yet`, `no_file`, `bad_upload`, `file_too_large`,
`course_not_found`, `document_not_found`, `page_not_found`, `unit_not_found`, `edge_not_found`,
`chunk_not_found`, `edge_exists` (409: remap would duplicate a unit/passage pair), `job_not_found`,
`rate_limited` (429), `contract_violation` (500, a server bug).
