import type { ExperienceStore, ExpListQuery, EpisodeStore } from "@exp-loop/core";
import type { MethodHandler } from "../server.js";

export function experienceMethods(stores: {
  experienceStore: ExperienceStore;
  episodeStore: EpisodeStore;
}): Record<string, MethodHandler> {
  return {
    "experiences.list": async (params) => {
      const query = (params.query as ExpListQuery) ?? undefined;
      const experiences = await stores.experienceStore.list(query);

      const enriched = await Promise.all(
        experiences.map(async (exp) => {
          let projectPath: string | undefined;
          for (const epId of exp.sourceEpisodeIds) {
            const episode = await stores.episodeStore.get(epId);
            if (episode?.task?.metadata?.projectPath) {
              projectPath = episode.task.metadata.projectPath as string;
              break;
            }
          }
          return { ...exp, projectPath };
        }),
      );

      return enriched;
    },
    "experiences.get": async (params) => {
      const exp = await stores.experienceStore.get(params.id as string);
      if (!exp) return null;

      let projectPath: string | undefined;
      for (const epId of exp.sourceEpisodeIds) {
        const episode = await stores.episodeStore.get(epId);
        if (episode?.task?.metadata?.projectPath) {
          projectPath = episode.task.metadata.projectPath as string;
          break;
        }
      }
      return { ...exp, projectPath };
    },
  };
}
