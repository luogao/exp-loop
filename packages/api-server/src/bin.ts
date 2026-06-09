import { buildServer } from "./index.js";
import { connectStdio } from "./transport-stdio.js";

async function main(): Promise<void> {
  const server = await buildServer();
  connectStdio(server);
  process.stderr.write("exp-loop api-server ready\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
