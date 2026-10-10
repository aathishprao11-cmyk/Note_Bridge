import type { PageHit } from './source';

/** Demo course used by the web app's mock fixtures (apps/web/src/lib/mockData.ts). */
export const DEMO_COURSE_ID = 'course-phys101';

type Candidate = Omit<PageHit, 'score'>;

const BOOK = { documentId: 'doc-book', documentTitle: 'University Physics: Ch. 2 (Kinematics)' };
const SLIDES = { documentId: 'doc-slides', documentTitle: 'Week 3: Kinematics slides' };

function chunk(
  doc: { documentId: string; documentTitle: string },
  role: 'book' | 'slides',
  page: number,
  offset: number,
  text: string,
): Candidate {
  return {
    chunkId: `${doc.documentId}-p${page}`,
    ...doc,
    role,
    page,
    printedPage: page + offset,
    text,
  };
}

/** Synthetic intro-physics text so the chat demo works with no keys and no uploads. */
export const DEMO_CHUNKS: Candidate[] = [
  chunk(
    BOOK,
    'book',
    41,
    0,
    'Displacement is the change in position of an object, a vector pointing from the initial position to the final position. Distance is the total path length travelled and is always positive.',
  ),
  chunk(
    BOOK,
    'book',
    42,
    0,
    'Average velocity is the displacement divided by the elapsed time. Average speed is the total distance divided by the elapsed time, so the two can differ.',
  ),
  chunk(
    BOOK,
    'book',
    43,
    0,
    'Instantaneous velocity is the limit of the average velocity as the time interval approaches zero. It equals the slope of the position-time graph at that instant.',
  ),
  chunk(
    BOOK,
    'book',
    44,
    0,
    'Acceleration is the rate of change of velocity with time. Its SI unit is metres per second squared.',
  ),
  chunk(
    BOOK,
    'book',
    45,
    0,
    'For constant acceleration the velocity changes linearly with time: v = v0 + a t. The position then follows x = x0 + v0 t + (1/2) a t^2.',
  ),
  chunk(
    BOOK,
    'book',
    46,
    0,
    'An object in free fall near the surface of the Earth accelerates downward at g = 9.8 m/s^2, ignoring air resistance.',
  ),
  chunk(
    BOOK,
    'book',
    47,
    0,
    'Worked example: a car accelerates from rest at 2 m/s^2 for 5 s, so its final velocity is v = 0 + 2 x 5 = 10 m/s.',
  ),
  chunk(
    BOOK,
    'book',
    48,
    0,
    'The area under a velocity-time graph equals the displacement, and the slope of a velocity-time graph equals the acceleration.',
  ),
  chunk(
    SLIDES,
    'slides',
    3,
    2,
    'Kinematics describes motion using displacement, velocity and acceleration without asking what causes it.',
  ),
  chunk(
    SLIDES,
    'slides',
    4,
    2,
    'Key equation for constant acceleration: v = v0 + a t. Remember that this only holds when a is constant.',
  ),
  chunk(
    SLIDES,
    'slides',
    5,
    2,
    'Free fall: take g = 9.81 m/s^2 downward. Sign conventions matter, so choose up as positive and stay consistent.',
  ),
];

const STOPWORDS = new Set(
  (
    'a an and are about all any can does did for from give has have how into its not off one our out ' +
    'tell that the their them then there these this those was what when where which who why will with ' +
    'you your explain describe show use used using say says mean means me my is it of on or in to be'
  ).split(' '),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

/** Hits scoring below this are dropped, so an unrelated question abstains instead of guessing. */
export const MIN_SCORE = 0.34;

/**
 * Deterministic keyword ranking: score is the share of distinct query words found in the chunk
 * (stems are matched by prefix so "accelerates" finds "acceleration"). Ties break on page, then id.
 */
export function rankHits(candidates: Candidate[], query: string, topK: number): PageHit[] {
  const words = [...new Set(tokenize(query))];
  if (words.length === 0) return [];
  const scored: PageHit[] = [];
  for (const c of candidates) {
    const haystack = tokenize(`${c.documentTitle} ${c.text}`);
    const matched = words.filter((w) =>
      haystack.some(
        (h) =>
          h === w ||
          (w.length >= 5 && (h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5)))),
      ),
    );
    const score = matched.length / words.length;
    if (score >= MIN_SCORE) scored.push({ ...c, score: Math.round(score * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score || a.page - b.page || a.chunkId.localeCompare(b.chunkId));
  return scored.slice(0, topK);
}
