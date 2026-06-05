import { resolve } from "path";
import type {
  EpisodeStore,
  ExperienceStore,
  PatternStore,
  SkillRegistry,
} from "@exp-loop/core";
import { FileSystemEpisodeStore } from "./fs-episode-store.js";
import { FileSystemExperienceStore } from "./fs-experience-store.js";
import { FileSystemPatternStore } from "./fs-pattern-store.js";
import { FileSystemSkillRegistry } from "./fs-skill-registry.js";

export interface FileSystemStores {
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
  patternStore: PatternStore;
  skillRegistry: SkillRegistry;
}

export function createFileSystemStores(baseDir: string): FileSystemStores {
  const resolved = resolve(baseDir);
  return {
    episodeStore: new FileSystemEpisodeStore(resolved),
    experienceStore: new FileSystemExperienceStore(resolved),
    patternStore: new FileSystemPatternStore(resolved),
    skillRegistry: new FileSystemSkillRegistry(resolved),
  };
}

export { FileSystemEpisodeStore } from "./fs-episode-store.js";
export { FileSystemExperienceStore } from "./fs-experience-store.js";
export { FileSystemPatternStore } from "./fs-pattern-store.js";
export { FileSystemSkillRegistry } from "./fs-skill-registry.js";
