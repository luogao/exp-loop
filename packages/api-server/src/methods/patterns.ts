import type { PatternStore } from "@exp-loop/core";
import type { MethodHandler } from "../server.js";

export function patternMethods(stores: {
  patternStore: PatternStore;
}): Record<string, MethodHandler> {
  return {
    "patterns.list": async () => {
      return stores.patternStore.list();
    },
    "patterns.get": async (params) => {
      return stores.patternStore.get(params.id as string);
    },
  };
}
