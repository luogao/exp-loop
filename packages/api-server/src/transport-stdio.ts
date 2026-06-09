import { createInterface } from "node:readline";
import type { ApiServer, JsonRpcRequest, JsonRpcNotification } from "./server.js";

export function connectStdio(server: ApiServer): void {
  server.setEmitter((notification: JsonRpcNotification) => {
    process.stdout.write(JSON.stringify(notification) + "\n");
  });

  const rl = createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let closing = false;

  function maybeExit(): void {
    if (closing && pending === 0) {
      process.exit(0);
    }
  }

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      const errorResponse = {
        jsonrpc: "2.0" as const,
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
      return;
    }

    if (!request.id && request.id !== 0) return;

    pending++;
    server
      .handleRequest(request)
      .then((response) => {
        process.stdout.write(JSON.stringify(response) + "\n");
      })
      .catch((err) => {
        const errorResponse = {
          jsonrpc: "2.0" as const,
          id: request.id,
          error: { code: -32603, message: String(err) },
        };
        process.stdout.write(JSON.stringify(errorResponse) + "\n");
      })
      .finally(() => {
        pending--;
        maybeExit();
      });
  });

  rl.on("close", () => {
    closing = true;
    maybeExit();
  });
}
