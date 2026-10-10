import { z } from 'zod';
import {
  AlignmentEdgeSchema,
  ChatExamplesResponse,
  CoverageReportSchema,
  CourseSchema,
  DocumentSchema,
  ExerciseSchema,
  LectureUnitSchema,
} from '../api-contract';
import chatJson from './chat.json';
import chunksJson from './chunks.json';
import courseJson from './course.json';
import coverageJson from './coverage.json';
import documentsJson from './documents.json';
import edgesJson from './edges.json';
import exercisesJson from './exercises.json';
import flagsJson from './flags.json';
import sectionsJson from './sections.json';
import unitsJson from './units.json';

/**
 * Demo course fixtures (intro physics, synthetic, copyright-free). Everything is validated
 * against the contract schemas when this module loads, so a fixture that drifts from the contract
 * fails immediately. `pnpm seed` writes these into SQLite; routes then read them from the DB.
 * Hand-written on purpose: no model produced these numbers.
 */

const SectionFixture = z.object({
  id: z.string(),
  documentId: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  level: z.number().int(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  summary: z.string(),
});
export type SectionFixture = z.infer<typeof SectionFixture>;

/** Book chunk as authored; seed derives the document, headers, links and printed pages. */
const ChunkFixture = z.object({
  id: z.string(),
  sectionId: z.string(),
  kind: z.enum(['text', 'definition', 'example', 'exercise', 'formula']),
  page: z.number().int(),
  text: z.string(),
});
export type ChunkFixture = z.infer<typeof ChunkFixture>;

const IngestFixture = z.record(
  z.string(),
  z.object({
    offsetConfidence: z.number(),
    headingSource: z.string(),
    warnings: z.array(z.string()),
    pageScores: z.array(z.number()).nullable(),
    defaultScore: z.number(),
  }),
);

const FeedbackFixture = z.array(
  z.object({
    id: z.string(),
    edgeId: z.string(),
    action: z.enum(['confirm', 'reject', 'remap']),
    createdAt: z.string(),
  }),
);

export const demo = {
  course: CourseSchema.parse(courseJson.course),
  documents: z.array(DocumentSchema).parse(documentsJson.documents),
  ingest: IngestFixture.parse(documentsJson.ingest),
  sections: z.array(SectionFixture).parse(sectionsJson.sections),
  chunks: z.array(ChunkFixture).parse(chunksJson.chunks),
  units: z.array(LectureUnitSchema).parse(unitsJson.units),
  edges: z.array(AlignmentEdgeSchema).parse(edgesJson.edges),
  feedback: FeedbackFixture.parse(edgesJson.feedback),
  unitFlags: z
    .array(z.object({ id: z.string(), unitId: z.string(), flag: z.literal('professor_only') }))
    .parse(flagsJson.unitFlags),
  chunkFlags: z
    .array(z.object({ id: z.string(), chunkId: z.string(), flag: z.literal('book_only') }))
    .parse(flagsJson.chunkFlags),
  exercises: z.array(ExerciseSchema).parse(exercisesJson.exercises),
  chatExamples: ChatExamplesResponse.parse(chatJson.chatExamples),
  coverage: CoverageReportSchema.parse(coverageJson.coverage),
};

export const DEMO_COURSE_ID = demo.course.id;
