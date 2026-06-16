import type { Episode, TraceStep, EpisodeStatus } from "@exp-loop/core";
import { generateId } from "@exp-loop/core";
import type { Session, SessionMessage } from "./types.js";

export interface DeltaContext {
  sessionId: string;
  projectPath?: string;
  deltaNumber: number;
  /** [startLine, endLine] JSONL line range of this delta. */
  lineRange: [number, number];
}

export interface SessionMapper {
  map(session: Session): Episode[];
  mapDelta(session: Session, ctx: DeltaContext): Episode[];
}

export function createSessionMapper(): SessionMapper {
  return {
    map(session: Session): Episode[] {
      const taskDescription = extractTaskDescription(session.messages);
      if (!taskDescription) return [];

      const steps = extractTraceSteps(session.messages);
      const status = inferStatus(session.messages);

      const episode: Episode = {
        id: generateId("ep"),
        task: {
          id: generateId("task"),
          description: taskDescription,
          metadata: {
            sessionId: session.id,
            source: session.source,
            projectPath: session.projectPath,
          },
        },
        status,
        trace: { steps },
        result: extractResult(session.messages),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      };

      return [episode];
    },

    mapDelta(session: Session, ctx: DeltaContext): Episode[] {
      const messages = session.messages;

      // task = first user message in this delta; synthesize a continuation title if none
      const firstUser = messages.find((m) => m.role === "user");
      const taskDescription = firstUser
        ? firstUser.content.slice(0, 500)
        : `<continuation of session ${ctx.sessionId}, delta ${ctx.deltaNumber}>`;

      const steps = extractTraceSteps(messages);
      const status = inferStatus(messages);

      const episode: Episode = {
        id: generateId("ep"),
        task: {
          id: generateId("task"),
          description: taskDescription,
          metadata: {
            sessionId: ctx.sessionId,
            source: session.source,
            projectPath: ctx.projectPath ?? session.projectPath,
            isDelta: true,
            deltaNumber: ctx.deltaNumber,
            sourceLineRange: ctx.lineRange,
          },
        },
        status,
        trace: { steps },
        result: extractResult(messages),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      };

      return [episode];
    },
  };
}

function extractTaskDescription(messages: SessionMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "";
  return firstUser.content.slice(0, 500);
}

function extractTraceSteps(messages: SessionMessage[]): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const msg of messages) {
    if (msg.role === "tool_use") {
      steps.push({
        index: steps.length,
        action: msg.toolName ?? msg.content,
        input: msg.toolInput,
      });
    } else if (msg.role === "tool_result") {
      const lastStep = steps[steps.length - 1];
      if (lastStep) {
        lastStep.output = msg.toolOutput;
        if (
          typeof msg.content === "string" &&
          msg.content.toLowerCase().includes("error")
        ) {
          lastStep.error = msg.content.slice(0, 200);
        }
      }
    }
  }

  if (steps.length === 0) {
    steps.push({ index: 0, action: "conversation" });
  }

  return steps;
}

function inferStatus(messages: SessionMessage[]): EpisodeStatus {
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  if (assistantMessages.length === 0) return "partial";

  const last = assistantMessages[assistantMessages.length - 1];
  const lower = last.content.toLowerCase();
  if (lower.includes("error") || lower.includes("failed")) return "partial";

  const toolResults = messages.filter((m) => m.role === "tool_result");
  const errorCount = toolResults.filter(
    (m) =>
      typeof m.content === "string" &&
      m.content.toLowerCase().includes("error"),
  ).length;
  if (errorCount > toolResults.length / 2) return "partial";

  return "success";
}

function extractResult(messages: SessionMessage[]): string | undefined {
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  if (assistantMessages.length === 0) return undefined;
  const last = assistantMessages[assistantMessages.length - 1];
  return last.content.slice(0, 1000);
}
