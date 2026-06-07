export interface ExpLoopMcpConfig {
  dataDir: string;
  llmProvider: "anthropic" | "none";
  llmModel: string;
  llmBaseUrl?: string;
  injectionFormat: "markdown" | "xml";
  topK: number;
}

export function parseConfig(): ExpLoopMcpConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  return {
    dataDir: process.env.EXP_LOOP_DATA_DIR || ".exp-loop",
    llmProvider: apiKey ? "anthropic" : "none",
    llmModel: process.env.EXP_LOOP_LLM_MODEL || "claude-sonnet-4-20250514",
    llmBaseUrl: process.env.ANTHROPIC_BASE_URL,
    injectionFormat:
      (process.env.EXP_LOOP_INJECTION_FORMAT as "markdown" | "xml") ||
      "markdown",
    topK: parseInt(process.env.EXP_LOOP_TOP_K || "5", 10),
  };
}
