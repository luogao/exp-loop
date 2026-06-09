import { readFile, writeFile, mkdir, access, readdir, open as fsOpen } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export type LlmKeySource = "manual" | "codex" | "hermes" | "env";

export interface AppConfig {
  dataDir: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel: string;
  llmKeySource: LlmKeySource;
  claudeProjectsDir?: string;
  enabledSources: string[];
  selectedProjects: string[];
}

export interface DetectedProject {
  path: string;
  name: string;
  sessionCount: number;
}

export interface DetectedSource {
  id: string;
  name: string;
  dataDir: string;
  available: boolean;
}

export interface DetectedCredential {
  source: LlmKeySource;
  label: string;
  available: boolean;
  keyPreview?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  dataDir: join(homedir(), ".exp-loop"),
  llmModel: "claude-sonnet-4-20250514",
  llmKeySource: "env",
  claudeProjectsDir: join(homedir(), ".claude", "projects"),
  enabledSources: ["claude-code"],
  selectedProjects: [],
};

function configPath(): string {
  return join(homedir(), ".exp-loop", "desktop-config.json");
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const content = await readFile(configPath(), "utf-8");
    const saved = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  const updated = { ...current, ...patch };
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(updated, null, 2));
  return updated;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectSources(): Promise<DetectedSource[]> {
  const home = homedir();
  const sources: Array<{ id: string; name: string; dir: string }> = [
    {
      id: "claude-code",
      name: "Claude Code",
      dir: join(home, ".claude", "projects"),
    },
    { id: "codex", name: "Codex", dir: join(home, ".codex", "sessions") },
    { id: "gemini", name: "Gemini CLI", dir: join(home, ".gemini", "tmp") },
    {
      id: "hermes",
      name: "Hermes",
      dir: join(home, ".hermes", "sessions"),
    },
  ];

  const results: DetectedSource[] = [];
  for (const s of sources) {
    results.push({
      id: s.id,
      name: s.name,
      dataDir: s.dir,
      available: await dirExists(s.dir),
    });
  }
  return results;
}

export async function detectProjects(config: AppConfig): Promise<DetectedProject[]> {
  const projects: DetectedProject[] = [];
  const projectsDir = config.claudeProjectsDir ?? join(homedir(), ".claude", "projects");

  let dirs: string[];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  for (const dirName of dirs) {
    const fullDir = join(projectsDir, dirName);
    let jsonlCount = 0;
    let cwd: string | undefined;

    try {
      const entries = await readdir(fullDir);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl") && !entry.startsWith("agent-")) {
          jsonlCount++;
          if (!cwd) {
            try {
              const fh = await fsOpen(join(fullDir, entry), "r");
              const buf = Buffer.alloc(4096);
              await fh.read(buf, 0, 4096, 0);
              await fh.close();
              const lines = buf.toString("utf-8").split("\n").slice(0, 10);
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.cwd) { cwd = parsed.cwd; break; }
                } catch { /* skip line */ }
              }
            } catch { /* skip file */ }
          }
        }
      }
    } catch {
      continue;
    }

    if (jsonlCount === 0) continue;

    const path = cwd || dirName;
    const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
    const name = segments.slice(-2).join("/");

    projects.push({ path, name, sessionCount: jsonlCount });
  }

  projects.sort((a, b) => b.sessionCount - a.sessionCount);
  return projects;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

export async function resolveCredentials(): Promise<DetectedCredential[]> {
  const credentials: DetectedCredential[] = [];

  // Manual is always available
  credentials.push({
    source: "manual",
    label: "Manual input",
    available: true,
  });

  // Check env vars
  const envKey =
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  credentials.push({
    source: "env",
    label: "Environment variable (ANTHROPIC_API_KEY)",
    available: !!envKey,
    keyPreview: envKey ? maskKey(envKey) : undefined,
  });

  // Check ~/.codex/auth.json for OpenAI key
  try {
    const codexAuth = await readFile(
      join(homedir(), ".codex", "auth.json"),
      "utf-8",
    );
    const parsed = JSON.parse(codexAuth);
    const openaiKey = parsed?.OPENAI_API_KEY as string | undefined;
    credentials.push({
      source: "codex",
      label: "Codex auth (~/.codex/auth.json → OPENAI_API_KEY)",
      available: !!openaiKey,
      keyPreview: openaiKey ? maskKey(openaiKey) : undefined,
    });
  } catch {
    credentials.push({
      source: "codex",
      label: "Codex auth (~/.codex/auth.json)",
      available: false,
    });
  }

  // Check ~/.hermes/auth.json
  try {
    const hermesAuth = await readFile(
      join(homedir(), ".hermes", "auth.json"),
      "utf-8",
    );
    const parsed = JSON.parse(hermesAuth);
    const xaiToken =
      parsed?.providers?.["xai-oauth"]?.tokens?.access_token as
        | string
        | undefined;
    credentials.push({
      source: "hermes",
      label: "Hermes auth (~/.hermes/auth.json → xAI token)",
      available: !!xaiToken,
      keyPreview: xaiToken ? maskKey(xaiToken) : undefined,
    });
  } catch {
    credentials.push({
      source: "hermes",
      label: "Hermes auth (~/.hermes/auth.json)",
      available: false,
    });
  }

  return credentials;
}

export async function resolveEffectiveApiKey(
  config: AppConfig,
): Promise<string> {
  if (config.llmKeySource === "manual") {
    return config.llmApiKey ?? "";
  }

  if (config.llmKeySource === "env") {
    return (
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      ""
    );
  }

  if (config.llmKeySource === "codex") {
    try {
      const codexAuth = await readFile(
        join(homedir(), ".codex", "auth.json"),
        "utf-8",
      );
      const parsed = JSON.parse(codexAuth);
      return (parsed?.OPENAI_API_KEY as string) ?? "";
    } catch {
      return "";
    }
  }

  if (config.llmKeySource === "hermes") {
    try {
      const hermesAuth = await readFile(
        join(homedir(), ".hermes", "auth.json"),
        "utf-8",
      );
      const parsed = JSON.parse(hermesAuth);
      return (
        (parsed?.providers?.["xai-oauth"]?.tokens?.access_token as string) ??
        ""
      );
    } catch {
      return "";
    }
  }

  return "";
}
