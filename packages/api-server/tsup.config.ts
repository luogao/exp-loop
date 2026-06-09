import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    splitting: false,
    external: ["@anthropic-ai/sdk"],
    noExternal: [
      "@exp-loop/core",
      "@exp-loop/store-fs",
      "@exp-loop/observer",
      "@exp-loop/syncer",
    ],
  },
  {
    entry: ["src/bin.ts"],
    format: ["esm"],
    clean: false,
    splitting: false,
    banner: { js: "#!/usr/bin/env node" },
    external: ["@anthropic-ai/sdk"],
    noExternal: [
      "@exp-loop/core",
      "@exp-loop/store-fs",
      "@exp-loop/observer",
      "@exp-loop/syncer",
    ],
  },
]);
