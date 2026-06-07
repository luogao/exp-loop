import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    splitting: false,
    external: ["@anthropic-ai/sdk", "@exp-loop/core", "@exp-loop/store-fs"],
    noExternal: ["@modelcontextprotocol/sdk", "zod"],
  },
  {
    entry: ["src/bin.ts"],
    format: ["esm"],
    clean: false,
    splitting: false,
    banner: { js: "#!/usr/bin/env node" },
    external: ["@anthropic-ai/sdk", "@exp-loop/core", "@exp-loop/store-fs"],
    noExternal: ["@modelcontextprotocol/sdk", "zod"],
  },
  {
    entry: {
      "hooks/retrieve": "src/hooks/retrieve.ts",
      "hooks/record": "src/hooks/record.ts",
    },
    format: ["esm"],
    clean: false,
    splitting: false,
    external: ["@anthropic-ai/sdk", "@exp-loop/core", "@exp-loop/store-fs"],
    noExternal: ["@modelcontextprotocol/sdk", "zod"],
  },
]);
