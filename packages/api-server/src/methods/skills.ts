import type { SkillRegistry, SkillQuery } from "@exp-loop/core";
import type { MethodHandler } from "../server.js";

export function skillMethods(stores: {
  skillRegistry: SkillRegistry;
}): Record<string, MethodHandler> {
  return {
    "skills.listSummaries": async (params) => {
      const query = (params.query as SkillQuery) ?? undefined;
      return stores.skillRegistry.listSummaries(query);
    },
    "skills.load": async (params) => {
      return stores.skillRegistry.load(params.id as string);
    },
  };
}
