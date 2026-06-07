import type { ExpLoopMcpConfig } from "./config.js";

export type LlmFunction = (prompt: string) => Promise<string>;

export async function createLlm(
  config: ExpLoopMcpConfig,
): Promise<LlmFunction> {
  if (config.llmProvider === "none") {
    return async () => "[]";
  }

  try {
    const apiKey =
      process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
    if (!apiKey) {
      process.stderr.write("[exp-loop] No API key found, using noop LLM\n");
      return async () => "[]";
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const clientOpts: Record<string, string> = { apiKey };
    if (config.llmBaseUrl) clientOpts.baseURL = config.llmBaseUrl;
    const client = new Anthropic(clientOpts);

    // Verify the client works
    process.stderr.write(
      `[exp-loop] LLM initialized (baseURL: ${config.llmBaseUrl || "default"})\n`,
    );

    return async (prompt: string): Promise<string> => {
      try {
        const response = await client.messages.create({
          model: config.llmModel,
          max_tokens: 4096,
          messages: [{ role: "user" as const, content: prompt }],
        });
        const textBlock = response.content.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b: any) => b.type === "text",
        );
        return textBlock ? textBlock.text : "[]";
      } catch (e: any) {
        process.stderr.write(`[exp-loop] LLM call failed: ${e.message}\n`);
        return "[]";
      }
    };
  } catch (e: any) {
    process.stderr.write(
      `[exp-loop] Failed to initialize LLM: ${e.message}\n`,
    );
    return async () => "[]";
  }
}
