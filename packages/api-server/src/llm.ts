import { type AppConfig, resolveEffectiveApiKey } from "./config.js";

export async function createLlm(
  config: AppConfig,
  onLlmCall?: (status: "start" | "done" | "error", detail?: string) => void,
): Promise<(prompt: string) => Promise<string>> {
  const apiKey = await resolveEffectiveApiKey(config);
  if (!apiKey) {
    return async () => "[]";
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const opts: Record<string, string> = { apiKey };
    if (config.llmBaseUrl) opts.baseURL = config.llmBaseUrl;
    const client = new Anthropic(opts);
    const model = config.llmModel || "claude-sonnet-4-20250514";

    return async (prompt: string): Promise<string> => {
      onLlmCall?.("start", `调用 ${model}`);
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{ role: "user" as const, content: prompt }],
        });
        const textBlock = response.content.find((b: any) => b.type === "text");
        onLlmCall?.("done", `${model} 返回 ${textBlock?.text?.length ?? 0} 字符`);
        return textBlock ? textBlock.text : "[]";
      } catch (e: any) {
        onLlmCall?.("error", e.message);
        process.stderr.write(`LLM call failed: ${e.message}\n`);
        return "[]";
      }
    };
  } catch {
    return async () => "[]";
  }
}

export async function validateLlm(config: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<{ valid: boolean; error?: string }> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const opts: Record<string, string> = { apiKey: config.apiKey };
    if (config.baseUrl) opts.baseURL = config.baseUrl;
    const client = new Anthropic(opts);

    await client.messages.create({
      model: config.model || "claude-sonnet-4-20250514",
      max_tokens: 10,
      messages: [{ role: "user" as const, content: "ping" }],
    });
    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}
