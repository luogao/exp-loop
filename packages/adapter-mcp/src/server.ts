import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createExpLoop,
  createExpExtractor,
  createExpGuard,
  createExpRetriever,
  createContextInjector,
  createPatternMiner,
  createSkillDistiller,
} from "@exp-loop/core";
import type {
  ExpExtractor,
  SkillDistiller,
  Episode,
  Pattern,
  SkillProposal,
} from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { parseConfig } from "./config.js";
import { createLlm } from "./llm.js";
import { registerTools } from "./tools.js";

export interface ServerContext {
  server: McpServer;
}

export function createServer(
  overrides?: Partial<ReturnType<typeof parseConfig>>,
): ServerContext {
  const config = { ...parseConfig(), ...overrides };
  const stores = createFileSystemStores(config.dataDir);

  const retriever = createExpRetriever({
    store: stores.experienceStore,
    topK: config.topK,
  });
  const guard = createExpGuard();
  const injector = createContextInjector({ format: config.injectionFormat });
  const patternMiner = createPatternMiner({
    episodeStore: stores.episodeStore,
    patternStore: stores.patternStore,
  });

  // Lazy wrappers — real LLM init happens on first call
  const extractor: ExpExtractor = {
    async extract(episode: Episode) {
      const llm = await createLlm(config);
      return createExpExtractor({ llm, maxCandidates: 3 }).extract(episode);
    },
  };
  const distiller: SkillDistiller = {
    async distill(pattern: Pattern): Promise<SkillProposal | null> {
      const llm = await createLlm(config);
      return createSkillDistiller({
        llm,
        episodeStore: stores.episodeStore,
        experienceStore: stores.experienceStore,
      }).distill(pattern);
    },
  };

  const runtime = createExpLoop({
    ...stores,
    retriever,
    guard,
    injector,
    extractor,
    patternMiner,
    skillDistiller: distiller,
  });

  const server = new McpServer({ name: "exp-loop", version: "0.1.0" });
  registerTools(server, runtime, stores);

  return { server };
}
