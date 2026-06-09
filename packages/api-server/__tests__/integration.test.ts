import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";

const BIN = join(__dirname, "..", "dist", "bin.js");

function rpc(
  requests: Array<{ id: number; method: string; params?: unknown }>,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [BIN], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", () => {
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      resolve(lines);
    });

    child.on("error", reject);

    const input = requests
      .map((r) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: r.id,
          method: r.method,
          params: r.params ?? {},
        }),
      )
      .join("\n") + "\n";

    child.stdin.write(input);
    child.stdin.end();
  });
}

describe("api-server stdio integration", () => {
  it("responds to stats.get", async () => {
    const [response] = (await rpc([{ id: 1, method: "stats.get" }])) as any[];
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result.episodes).toBeDefined();
    expect(response.result.experiences).toBeDefined();
  }, 15000);

  it("responds to config.get with defaults", async () => {
    const [response] = (await rpc([{ id: 1, method: "config.get" }])) as any[];
    expect(response.result.dataDir).toBeDefined();
    expect(response.result.llmModel).toBe("claude-sonnet-4-20250514");
  }, 15000);

  it("returns error for unknown method", async () => {
    const [response] = (await rpc([{ id: 1, method: "does.not.exist" }])) as any[];
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);
  }, 15000);

  it("handles multiple requests in a single session", async () => {
    const responses = (await rpc([
      { id: 1, method: "stats.get" },
      { id: 2, method: "config.get" },
      { id: 3, method: "patterns.list" },
    ])) as any[];

    expect(responses).toHaveLength(3);
    const ids = responses.map((r) => r.id).sort();
    expect(ids).toEqual([1, 2, 3]);
  }, 15000);
});
