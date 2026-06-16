import type {
  Episode,
  Experience,
  ExperienceCandidate,
  ExperienceRevision,
  ExperienceStore,
  ExtractContext,
  Skill,
  BeforeRunInput,
  BeforeRunResult,
  AfterRunInput,
  AfterRunResult,
  ExpLoopConfig,
  ExpLoopRuntime,
  Scope,
} from "./types.js";
import { topKSimilar } from "./similarity.js";
import { generateId } from "./utils.js";

export function createExpLoop(config: ExpLoopConfig): ExpLoopRuntime {
  const {
    episodeStore,
    experienceStore,
    retriever,
    extractor,
    guard,
    injector,
    skillRegistry,
    patternMiner,
    skillDistiller,
  } = config;

  return {
    async beforeRun(input: BeforeRunInput): Promise<BeforeRunResult> {
      const experiences = await retriever.retrieve({ task: input.task });

      const skillSummaries = skillRegistry
        ? await skillRegistry.listSummaries({
            domain: input.task.domain,
            taskType: input.task.taskType,
          })
        : [];

      const promptBlock = injector.render(experiences, skillSummaries);

      const loadSkill = async (id: string): Promise<Skill> => {
        if (!skillRegistry) throw new Error("SkillRegistry not configured");
        const skill = await skillRegistry.load(id);
        if (!skill) throw new Error(`Skill not found: ${id}`);
        return skill;
      };

      return { promptBlock, experiences, skillSummaries, loadSkill };
    },

    async afterRun(input: AfterRunInput): Promise<AfterRunResult> {
      const episode: Episode = {
        id: generateId("ep"),
        task: input.task,
        status: input.status,
        trace: input.trace,
        result: input.result,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      };
      await episodeStore.save(episode);

      // Determine scope from episode's projectPath
      const projectPath = input.task.metadata?.projectPath as string | undefined;
      const scope: Scope = projectPath ? "project" : "global";

      // For merge checking, only load experiences within the same scope (+ project match)
      const existingExps = await experienceStore.list({ scope });

      const isDelta = input.isDelta === true;

      // Delta routing: hand the LLM the FULL same-scope experience title list so
      // it can do SEMANTIC duplicate detection. Lexical pre-screening cannot
      // catch same-lesson-different-wording duplicates, so we don't rely on it
      // for routing — the LLM sees every title and decides new/merge/update.
      // (Titles only, so this stays cheap even with many experiences.)
      const extractCtx: ExtractContext | undefined =
        isDelta && existingExps.length > 0
          ? {
              isDelta: true,
              sessionId: input.task.metadata?.sessionId as string | undefined,
              existingExperienceTitles: existingExps.map((e) => ({
                id: e.id,
                title: e.title,
              })),
            }
          : undefined;

      const candidates = (await extractor.extract(episode, extractCtx)).map(
        normalizeCandidate,
      );

      const newExperiences: Experience[] = [];
      const updatedExperiences: Experience[] = [];
      const rejectedCandidates: {
        candidate: ExperienceCandidate;
        reason: string;
      }[] = [];

      // `existingExps` is mutated as we accept new experiences so that later
      // candidates in the SAME batch can de-duplicate against earlier ones
      // (candidate-vs-candidate), not just against pre-existing experiences.
      for (const candidate of candidates) {
        const scopedCandidate = { ...candidate, scope };
        const hint = scopedCandidate.routingHint;
        const hintTarget = hint?.targetExperienceId
          ? existingExps.find((e) => e.id === hint.targetExperienceId)
          : undefined;

        // ── Delta routing: TRUST the LLM's semantic judgment ──────────────
        // The LLM saw the full title list and decided merge/update vs new.
        // Lexical similarity cannot detect paraphrased duplicates, so the LLM
        // hint is authoritative for deltas. Local similarity is only a backstop.
        if (isDelta && hint?.action === "update" && hintTarget) {
          const updated = applyExperienceUpdate(hintTarget, scopedCandidate, episode.id);
          await experienceStore.update(hintTarget.id, {
            recommendation: updated.recommendation,
            applyWhen: updated.applyWhen,
            avoid: updated.avoid,
            triggers: updated.triggers,
            title: updated.title,
            history: updated.history,
            version: updated.version,
            sourceEpisodeIds: updated.sourceEpisodeIds,
            evidence: updated.evidence,
            needsReview: true,
            updatedAt: new Date().toISOString(),
          });
          const idx = existingExps.findIndex((e) => e.id === hintTarget.id);
          if (idx >= 0) existingExps[idx] = updated;
          updatedExperiences.push(updated);
          continue;
        }

        if (isDelta && hint?.action === "merge" && hintTarget) {
          await mergeInto(hintTarget, scopedCandidate, episode.id, experienceStore);
          if (!updatedExperiences.some((e) => e.id === hintTarget.id)) {
            updatedExperiences.push({ ...hintTarget, needsReview: true });
          }
          hintTarget.sourceEpisodeIds = [
            ...new Set([...hintTarget.sourceEpisodeIds, episode.id]),
          ];
          continue;
        }

        // ── Local similarity backstop (catches verbatim/near-verbatim dupes) ──
        const candInput = {
          title: candidate.title,
          triggers: candidate.triggers,
          problem: candidate.problem,
          recommendation: candidate.recommendation,
        };
        const bestMatch = topKSimilar(candInput, existingExps, 1)[0];
        const similarTarget = bestMatch?.item;
        const isSimilar = !!bestMatch && bestMatch.score >= 0.4;

        if (isSimilar && similarTarget) {
          await mergeInto(similarTarget, scopedCandidate, episode.id, experienceStore);
          if (!updatedExperiences.some((e) => e.id === similarTarget.id)) {
            updatedExperiences.push({ ...similarTarget, needsReview: true });
          }
          similarTarget.sourceEpisodeIds = [
            ...new Set([...similarTarget.sourceEpisodeIds, episode.id]),
          ];
          continue;
        }

        // ── Genuinely new → guard quality checks, then accept ──────────────
        const guardResult = await guard.evaluate(scopedCandidate, existingExps);
        if (guardResult.decision === "merge" && guardResult.mergeTargetId) {
          const target = existingExps.find(
            (e) => e.id === guardResult.mergeTargetId,
          );
          if (target) {
            await mergeInto(target, scopedCandidate, episode.id, experienceStore);
            if (!updatedExperiences.some((e) => e.id === target.id)) {
              updatedExperiences.push({ ...target, needsReview: true });
            }
            target.sourceEpisodeIds = [
              ...new Set([...target.sourceEpisodeIds, episode.id]),
            ];
          }
          continue;
        }

        if (guardResult.decision === "accept") {
          const exp = candidateToExperience(scopedCandidate, episode.id);
          await experienceStore.save(exp);
          existingExps.push(exp); // visible to later candidates this batch
          newExperiences.push(exp);
        } else {
          rejectedCandidates.push({
            candidate,
            reason: guardResult.reason,
          });
        }
      }

      let updatedPatterns = config.patternMiner
        ? await patternMiner!.mine(episode)
        : [];

      const skillProposals = [];
      if (skillDistiller && updatedPatterns.length > 0) {
        for (const pattern of updatedPatterns) {
          if (pattern.promotion === "candidate_skill") {
            const proposal = await skillDistiller.distill(pattern);
            if (proposal) skillProposals.push(proposal);
          }
        }
      }

      return {
        episodeId: episode.id,
        newExperiences,
        updatedExperiences,
        rejectedCandidates,
        updatedPatterns,
        skillProposals,
      };
    },
  };
}

/**
 * Fold a duplicate candidate into an existing experience as additional evidence:
 * union sourceEpisodeIds + evidence, keep the existing content, mark for review.
 */
async function mergeInto(
  target: Experience,
  candidate: ExperienceCandidate,
  episodeId: string,
  store: ExperienceStore,
): Promise<void> {
  await store.update(target.id, {
    sourceEpisodeIds: [...new Set([...target.sourceEpisodeIds, episodeId])],
    evidence: [
      ...new Set([
        ...(target.evidence ?? []),
        ...(candidate.evidence ?? []),
      ]),
    ],
    triggers: [...new Set([...target.triggers, ...candidate.triggers])],
    needsReview: true,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Apply an "update" routing hint: push the old recommendation into history,
 * replace the content fields with the candidate's corrected recommendation.
 */
function applyExperienceUpdate(
  target: Experience,
  candidate: ExperienceCandidate,
  episodeId: string,
): Experience {
  const now = new Date().toISOString();
  const revision: ExperienceRevision = {
    version: target.version,
    recommendation: target.recommendation,
    mergedFromEpisodeId: episodeId,
    replacedAt: now,
  };
  return {
    ...target,
    title: candidate.title || target.title,
    recommendation: candidate.recommendation,
    applyWhen: candidate.applyWhen.length ? candidate.applyWhen : target.applyWhen,
    avoid: candidate.avoid ?? target.avoid,
    triggers: candidate.triggers.length ? candidate.triggers : target.triggers,
    evidence: [
      ...new Set([...(target.evidence ?? []), ...(candidate.evidence ?? [])]),
    ],
    sourceEpisodeIds: [...new Set([...target.sourceEpisodeIds, episodeId])],
    history: [...(target.history ?? []), revision],
    version: target.version + 1,
    needsReview: true,
    updatedAt: now,
  };
}

function candidateToExperience(
  candidate: ExperienceCandidate,
  episodeId: string,
): Experience {
  const now = new Date().toISOString();
  return {
    id: generateId("exp"),
    title: candidate.title,
    domain: candidate.domain,
    taskType: candidate.taskType,
    scope: candidate.scope ?? "global",
    triggers: candidate.triggers,
    problem: candidate.problem,
    recommendation: candidate.recommendation,
    applyWhen: candidate.applyWhen,
    avoid: candidate.avoid,
    evidence: candidate.evidence,
    sourceEpisodeIds: [episodeId],
    confidence: candidate.confidence,
    version: 1,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function ensureArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return [val];
  return [];
}

function normalizeCandidate(
  candidate: ExperienceCandidate,
): ExperienceCandidate {
  return {
    ...candidate,
    triggers: ensureArray(candidate.triggers),
    applyWhen: ensureArray(candidate.applyWhen),
    avoid: ensureArray(candidate.avoid),
    evidence: ensureArray(candidate.evidence),
    confidence:
      typeof candidate.confidence === "number" ? candidate.confidence : 0.5,
  };
}
