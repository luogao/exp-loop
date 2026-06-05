import type {
  Episode,
  Experience,
  ExperienceCandidate,
  Skill,
  BeforeRunInput,
  BeforeRunResult,
  AfterRunInput,
  AfterRunResult,
  ExpLoopConfig,
  ExpLoopRuntime,
} from "./types.js";
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

      const candidates = await extractor.extract(episode);

      const existingExps = await experienceStore.list();
      const newExperiences: Experience[] = [];
      const rejectedCandidates: {
        candidate: ExperienceCandidate;
        reason: string;
      }[] = [];

      for (const candidate of candidates) {
        const guardResult = await guard.evaluate(candidate, existingExps);

        if (guardResult.decision === "accept") {
          const exp = candidateToExperience(candidate, episode.id);
          await experienceStore.save(exp);
          newExperiences.push(exp);
        } else if (
          guardResult.decision === "merge" &&
          guardResult.mergeTargetId
        ) {
          const target = existingExps.find(
            (e) => e.id === guardResult.mergeTargetId,
          );
          if (target) {
            await experienceStore.update(guardResult.mergeTargetId, {
              sourceEpisodeIds: [
                ...new Set([...target.sourceEpisodeIds, episode.id]),
              ],
              evidence: [
                ...new Set([
                  ...(target.evidence ?? []),
                  ...(candidate.evidence ?? []),
                ]),
              ],
              needsReview: true,
              updatedAt: new Date().toISOString(),
            });
          }
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
        rejectedCandidates,
        updatedPatterns,
        skillProposals,
      };
    },
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
