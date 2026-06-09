import type { EpisodeStore, EpisodeQuery } from "@exp-loop/core";
import type { MethodHandler } from "../server.js";

export function episodeMethods(stores: {
  episodeStore: EpisodeStore;
}): Record<string, MethodHandler> {
  return {
    "episodes.list": async (params) => {
      const query = (params.query as EpisodeQuery) ?? undefined;
      return stores.episodeStore.list(query);
    },
    "episodes.get": async (params) => {
      return stores.episodeStore.get(params.id as string);
    },
  };
}
