import type {
  EpisodeStore,
  ExperienceStore,
  PatternStore,
  SkillRegistry,
  Episode,
  Experience,
} from "@exp-loop/core";
import type { MethodHandler } from "../server.js";

export function statsMethods(stores: {
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
  patternStore: PatternStore;
  skillRegistry: SkillRegistry;
}): Record<string, MethodHandler> {
  return {
    "stats.get": async () => {
      const [episodes, experiences, patterns, skills] = await Promise.all([
        stores.episodeStore.list(),
        stores.experienceStore.list(),
        stores.patternStore.list(),
        stores.skillRegistry.listSummaries(),
      ]);

      return {
        episodes: {
          total: episodes.length,
          success: episodes.filter((e) => e.status === "success").length,
          partial: episodes.filter((e) => e.status === "partial").length,
          failure: episodes.filter((e) => e.status === "failure").length,
        },
        experiences: {
          total: experiences.length,
          active: experiences.filter((e) => e.status === "active").length,
          draft: experiences.filter((e) => e.status === "draft").length,
          deprecated: experiences.filter((e) => e.status === "deprecated").length,
        },
        patterns: {
          total: patterns.length,
          candidateSkill: patterns.filter((p) => p.promotion === "candidate_skill").length,
        },
        skills: {
          total: skills.length,
        },
      };
    },

    "stats.byProject": async () => {
      const [episodes, experiences] = await Promise.all([
        stores.episodeStore.list(),
        stores.experienceStore.list(),
      ]);

      const episodesByProject = new Map<string, Episode[]>();
      for (const ep of episodes) {
        const project = (ep.task?.metadata?.projectPath as string) || "";
        if (!project) continue;
        if (!episodesByProject.has(project)) episodesByProject.set(project, []);
        episodesByProject.get(project)!.push(ep);
      }

      const expByProject = new Map<string, Experience[]>();
      for (const exp of experiences) {
        let project = "";
        for (const epId of exp.sourceEpisodeIds) {
          const ep = await stores.episodeStore.get(epId);
          if (ep?.task?.metadata?.projectPath) {
            project = ep.task.metadata.projectPath as string;
            break;
          }
        }
        if (!project) continue;
        if (!expByProject.has(project)) expByProject.set(project, []);
        expByProject.get(project)!.push(exp);
      }

      const allProjects = new Set([
        ...episodesByProject.keys(),
        ...expByProject.keys(),
      ]);

      const result = [...allProjects].map((project) => {
        const eps = episodesByProject.get(project) ?? [];
        const exps = expByProject.get(project) ?? [];
        const segments = project.replace(/\\/g, "/").split("/").filter(Boolean);
        const lastEp = eps.sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1))[0];

        return {
          projectPath: project,
          projectName: segments.slice(-2).join("/"),
          episodes: eps.length,
          successCount: eps.filter((e) => e.status === "success").length,
          experiences: exps.length,
          activeExperiences: exps.filter((e) => e.status === "active").length,
          lastSessionAt: lastEp?.endedAt,
        };
      });

      result.sort((a, b) => {
        if (!a.lastSessionAt) return 1;
        if (!b.lastSessionAt) return -1;
        return a.lastSessionAt < b.lastSessionAt ? 1 : -1;
      });
      return result;
    },
  };
}
