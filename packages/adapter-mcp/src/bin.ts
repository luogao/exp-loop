import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const { server } = createServer();
const transport = new StdioServerTransport();
server.connect(transport).catch((e: Error) => {
  process.stderr.write(`[exp-loop] Connection error: ${e.message}\n`);
  process.exit(1);
});
