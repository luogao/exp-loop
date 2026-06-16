/**
 * Experience similarity matching — used for:
 *   1. Deduplicating existing experiences (cleanup script)
 *   2. Pre-screening candidates for delta routing (top-K to feed the LLM)
 *
 * The goal is to flag experiences that talk about the SAME underlying lesson even
 * when worded differently ("Add stderr reader thread" ≈ "Capture sidecar stderr
 * via dedicated reader thread"). We combine several cheap lexical signals rather
 * than calling an embedding model, to keep it cost-free.
 */

import type { Experience, ExistingExperienceSummary } from "./types.js";

/** English stop-words ignored when tokenizing titles. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with",
  "from", "by", "via", "as", "is", "are", "be", "use", "using", "when",
  "after", "before", "into", "that", "this", "it", "its", "your",
  "not", "do", "does", "don't", "dont", "how", "what", "which",
]);

/** Tokenize a string into meaningful lowercase word tokens (length ≥ 3, non-stop). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .split(/[^a-z0-9_']+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Dice coefficient over two token sets: 2|A∩B| / (|A|+|B|). In [0,1]. */
function dice(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

/**
 * Stem a token very crudely (strip common plural/ing/ed suffixes) so that
 * "reader"/"readers" and "capture"/"capturing" collide.
 */
function stem(t: string): string {
  return t
    .replace(/(ings?|ed|ers?|s)$/, "")
    .replace(/(.)\1$/, "$1");
}

/** Tokenize + stem. */
function contentTokens(text: string): string[] {
  return tokenize(text).map(stem);
}

export interface SimilarityInput {
  title: string;
  triggers?: string[];
  problem?: string;
  recommendation?: string;
}

/**
 * Compute a similarity score in [0,1] between two experiences based on lexical
 * overlap across title, triggers, problem, and recommendation.
 *
 * Weighting favors title + triggers (the discriminative fields) but lets strong
 * overlap in recommendation/problem rescue near-synonyms.
 */
export function experienceSimilarity(
  a: SimilarityInput,
  b: SimilarityInput,
): number {
  const titleA = contentTokens(a.title);
  const titleB = contentTokens(b.title);
  const titleScore = dice(titleA, titleB);

  const trigA = new Set((a.triggers ?? []).flatMap((t) => contentTokens(t)));
  const trigB = new Set((b.triggers ?? []).flatMap((t) => contentTokens(t)));
  let trigScore = 0;
  if (trigA.size > 0 && trigB.size > 0) {
    let inter = 0;
    for (const t of trigA) if (trigB.has(t)) inter++;
    trigScore = inter / Math.max(trigA.size, trigB.size);
  }

  const recA = contentTokens(a.recommendation ?? "");
  const recB = contentTokens(b.recommendation ?? "");
  const recScore = dice(recA, recB);

  const probA = contentTokens(a.problem ?? "");
  const probB = contentTokens(b.problem ?? "");
  const probScore = dice(probA, probB);

  // Weighted blend. Title is the strongest single signal; triggers are highly
  // discriminative; recommendation/problem help when wording diverges.
  return (
    0.4 * titleScore +
    0.25 * trigScore +
    0.2 * recScore +
    0.15 * probScore
  );
}

/** Minimum score to consider two experiences "about the same thing". */
export const SIMILARITY_THRESHOLD = 0.32;

/**
 * Rank `pool` by similarity to `query` and return the top-K (most similar first).
 * Used to pre-screen existing experiences before feeding a small set to the LLM.
 */
export function topKSimilar<T extends SimilarityInput>(
  query: SimilarityInput,
  pool: T[],
  k: number,
  minScore = SIMILARITY_THRESHOLD,
): Array<{ item: T; score: number }> {
  return pool
    .map((item) => ({ item, score: experienceSimilarity(query, item) }))
    .filter((x) => x.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

// ── Adapters ──────────────────────────────────────────────────────────

export function experienceToSimilarityInput(
  e: Experience,
): SimilarityInput {
  return {
    title: e.title,
    triggers: e.triggers,
    problem: e.problem,
    recommendation: e.recommendation,
  };
}

export function summaryToSimilarityInput(
  s: ExistingExperienceSummary,
): SimilarityInput {
  return {
    title: s.title,
    triggers: s.triggers,
    problem: s.problem,
    recommendation: s.recommendation,
  };
}
