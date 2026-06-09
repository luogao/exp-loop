import type { MethodHandler } from "../server.js";
import { detectSources, resolveCredentials, detectProjects, loadConfig } from "../config.js";

export function sourceMethods(): Record<string, MethodHandler> {
  return {
    "sources.detect": async () => {
      return detectSources();
    },
    "sources.detectProjects": async () => {
      const config = await loadConfig();
      return detectProjects(config);
    },
    "config.resolveCredentials": async () => {
      return resolveCredentials();
    },
  };
}
