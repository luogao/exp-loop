import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
  // @anthropic-ai/sdk depends on Node builtins (punycode) via require(), which
  // breaks when bundled into ESM. Keep it external so it resolves from node_modules
  // at runtime with native ESM.
  noExternal: [],
  external: ["@anthropic-ai/sdk"],
});

