import { describe, expect, it } from 'vitest';
import {
  AlignmentQuery,
  ChatBody,
  ChatEvent,
  CreateCourseBody,
  PatchEdgeBody,
  ROUTES,
  UploadFields,
} from '../src/api-contract';

/** Every route listed in BRIEF Section 14 (plugin routes are owned by plugins). */
const SECTION_14: Array<[string, string]> = [
  ['POST', '/api/courses'],
  ['GET', '/api/courses'],
  ['GET', '/api/courses/:id'],
  ['POST', '/api/courses/:id/documents'],
  ['GET', '/api/jobs/:id/events'],
  ['POST', '/api/courses/:id/align'],
  ['GET', '/api/courses/:id/alignment'],
  ['PATCH', '/api/edges/:id'],
  ['GET', '/api/courses/:id/coverage'],
  ['GET', '/api/units/:id'],
  ['GET', '/api/documents/:id/pages/:n'],
  ['GET', '/api/documents/:id/quality'],
  ['GET', '/api/edges/:id/signals'],
  ['POST', '/api/courses/:id/chat'],
];

describe('api contract', () => {
  it('has a route entry for every Section 14 route', () => {
    const have = new Set(Object.values(ROUTES).map((r) => `${r.method} ${r.path}`));
    for (const [method, path] of SECTION_14) expect(have).toContain(`${method} ${path}`);
  });

  it('marks the two streaming routes as SSE', () => {
    expect(ROUTES.jobEvents.sse).toBe(true);
    expect(ROUTES.chat.sse).toBe(true);
    expect(ROUTES.alignment.sse).toBeUndefined();
  });

  it('validates course creation', () => {
    expect(CreateCourseBody.parse({ name: '  Physics 101 ' }).name).toBe('Physics 101');
    expect(CreateCourseBody.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateCourseBody.safeParse({}).success).toBe(false);
  });

  it('validates upload fields against the Section 5 document kinds', () => {
    expect(UploadFields.safeParse({ kind: 'handwritten' }).success).toBe(true);
    expect(UploadFields.safeParse({ kind: 'notes' }).success).toBe(false);
    expect(UploadFields.safeParse({ kind: 'book', level: 'expert' }).success).toBe(false);
  });

  it('requires a target chunk to remap an edge', () => {
    expect(PatchEdgeBody.safeParse({ action: 'confirm' }).success).toBe(true);
    expect(PatchEdgeBody.safeParse({ action: 'remap' }).success).toBe(false);
    expect(PatchEdgeBody.safeParse({ action: 'remap', chunkId: 'c1' }).success).toBe(true);
    expect(PatchEdgeBody.safeParse({ action: 'delete' }).success).toBe(false);
  });

  it('coerces alignment filters from the query string and rejects bad ones', () => {
    const q = AlignmentQuery.parse({ relation: 'conflicts', minConfidence: '0.5' });
    expect(q.minConfidence).toBe(0.5);
    expect(AlignmentQuery.safeParse({ relation: 'same' }).success).toBe(false);
    expect(AlignmentQuery.safeParse({ minConfidence: '2' }).success).toBe(false);
  });

  it('accepts all five relation filters', () => {
    for (const relation of ['covers', 'extends', 'conflicts', 'professor_only', 'book_only']) {
      expect(AlignmentQuery.safeParse({ relation }).success).toBe(true);
    }
  });

  it('validates chat bodies and stream events', () => {
    expect(ChatBody.safeParse({ message: '' }).success).toBe(false);
    expect(ChatBody.safeParse({ message: 'Why do the formulas differ?' }).success).toBe(true);
    expect(ChatEvent.safeParse({ type: 'text', delta: 'Hi' }).success).toBe(true);
    expect(ChatEvent.safeParse({ type: 'text' }).success).toBe(false);
    expect(ChatEvent.safeParse({ type: 'bogus' }).success).toBe(false);
  });
});
