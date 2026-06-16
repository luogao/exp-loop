import { buildServer } from "./index.js";
import { connectStdio } from "./transport-stdio.js";

function stderrLog(level: string, message: string, detail?: string): void {
  process.stderr.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(detail ? { detail } : {}),
    }) + "\n",
  );
}

async function main(): Promise<void> {
  const server = await buildServer();
  connectStdio(server);
  stderrLog("info", "exp-loop api-server ready");
}

main().catch((err) => {
  stderrLog("error", `Fatal: ${err.message}`);
  process.exit(1);
});
