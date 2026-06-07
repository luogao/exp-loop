import {
  createExpLoop,
  createExpExtractor,
  createExpGuard,
  createExpRetriever,
  createContextInjector,
  createPatternMiner,
  createSkillDistiller,
  generateId,
} from "@exp-loop/core";
import type { EpisodeStatus, TraceStep } from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

interface TranscriptEntry {
  type: string;
  role?: string;
  content?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

async function main(): Promise<void> {
  const input = await readStdin();
  const data = JSON.parse(input);
  const cwd: string = data.cwd || process.cwd();
  const transcriptPath: string = data.transcript_path || "";
  const lastMessage: string = data.last_assistant_message || "";

  const dataDir = resolve(cwd, ".exp-loop");
  const stores = createFileSystemStores(dataDir);

  // Determine task description and status from transcript
  const { taskDescription, status, steps } = parseTranscript(
    transcriptPath,
    lastMessage,
  );

  if (!taskDescription) {
    process.exit(0);
  }

  const llm = async () => "[]";

  const retriever = createExpRetriever({ store: stores.experienceStore });
  const guard = createExpGuard();
  const injector = createContextInjector({ format: "markdown" });
  const extractor = createExpExtractor({ llm });
  const patternMiner = createPatternMiner({
    episodeStore: stores.episodeStore,
    patternStore: stores.patternStore,
  });
  const skillDistiller = createSkillDistiller({
    llm,
    episodeStore: stores.episodeStore,
    experienceStore: stores.experienceStore,
  });

  const runtime = createExpLoop({
    ...stores,
    retriever,
    guard,
    injector,
    extractor,
    patternMiner,
    skillDistiller,
  });

  const now = new Date().toISOString();
  await runtime.afterRun({
    task: {
      id: generateId("task"),
      description: taskDescription,
    },
    status,
    trace: { steps },
    result: lastMessage,
    startedAt: now,
    endedAt: now,
  });
}

function parseTranscript(
  transcriptPath: string,
  lastMessage: string,
): {
  taskDescription: string;
  status: EpisodeStatus;
  steps: TraceStep[];
} {
  let taskDescription = "";
  const steps: TraceStep[] = [];
  let status: EpisodeStatus = "success";

  if (transcriptPath && existsSync(transcriptPath)) {
    try {
      const content = readFileSync(transcriptPath, "utf-8");
      const lines = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as TranscriptEntry);

      for (let i = 0; i < lines.length; i++) {
        const entry = lines[i];

        // Extract the first user message as the task description
        if (!taskDescription && entry.type === "human") {
          const text =
            typeof entry.content === "string"
              ? entry.content
              : entry.message?.content &&
                  typeof entry.message.content === "string"
                ? entry.message.content
                : "";
          if (text) taskDescription = text.slice(0, 500);
        }

        // Extract tool use steps
        if (entry.type === "tool_use" || entry.type === "tool_result") {
          const action =
            typeof entry.content === "string"
              ? entry.content.slice(0, 200)
              : "tool call";
          steps.push({ index: steps.length, action });
        }

        // Check for errors
        if (
          entry.type === "tool_result" &&
          typeof entry.content === "string" &&
          entry.content.includes("error")
        ) {
          status = "partial";
        }
      }
    } catch {
      // Can't parse transcript, fall through
    }
  }

  // Fallback: use last assistant message to infer status
  if (!taskDescription && lastMessage) {
    taskDescription = "Claude Code session";
  }

  if (
    lastMessage.toLowerCase().includes("error") ||
    lastMessage.toLowerCase().includes("failed")
  ) {
    status = "partial";
  }

  // Ensure at least one step
  if (steps.length === 0 && lastMessage) {
    steps.push({ index: 0, action: "completed task" });
  }

  return { taskDescription, status, steps };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

main().catch(() => process.exit(1));
