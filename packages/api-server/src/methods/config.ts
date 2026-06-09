import type { MethodHandler } from "../server.js";
import { loadConfig, saveConfig, resolveEffectiveApiKey } from "../config.js";
import { validateLlm } from "../llm.js";

export function configMethods(
  onConfigChange: (config: Awaited<ReturnType<typeof loadConfig>>) => void,
): Record<string, MethodHandler> {
  return {
    "config.get": async () => {
      return loadConfig();
    },
    "config.set": async (params) => {
      const patch = params.patch as Record<string, unknown>;
      const updated = await saveConfig(patch);
      onConfigChange(updated);
      return updated;
    },
    "config.validate": async (params) => {
      const config = await loadConfig();
      let apiKey = params.apiKey as string | undefined;

      if (!apiKey) {
        const keySource = (params.keySource as string | undefined) ?? config.llmKeySource;
        apiKey = await resolveEffectiveApiKey({ ...config, llmKeySource: keySource as any });
      }

      if (!apiKey) {
        return { valid: false, error: "未找到可用的 API Key" };
      }

      return validateLlm({
        apiKey,
        baseUrl: (params.baseUrl as string | undefined) ?? config.llmBaseUrl,
        model: (params.model as string | undefined) ?? config.llmModel,
      });
    },
  };
}
