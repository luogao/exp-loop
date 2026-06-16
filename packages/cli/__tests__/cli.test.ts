import { describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const CLI = join(__dirname, "..", "dist", "index.js");

async function run(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("node", [CLI, ...args], {
      env: { ...process.env, ...env },
      timeout: 15000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("exp-loop CLI", () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "cli-test-"));
    dataDir = join(tmpDir, ".exp-loop");
    await mkdir(dataDir, { recursive: true });
  });

  it("shows help with --help", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("exp-loop");
    expect(stdout).toContain("observe");
    expect(stdout).toContain("sync");
    expect(stdout).toContain("learn");
    expect(stdout).toContain("skills");
    expect(stdout).toContain("stats");
  });

  it("shows version with --version", async () => {
    const { stdout } = await run(["--version"]);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("stats command runs on empty data dir", async () => {
    const { stdout } = await run(["stats", "--project", tmpDir]);
    expect(stdout).toContain("exp-loop stats");
    expect(stdout).toContain("Episodes:");
    expect(stdout).toContain("Experiences:");
    expect(stdout).toContain("Patterns:");
    expect(stdout).toContain("Skills:");
  });

  it("stats shows zero counts for fresh project", async () => {
    const { stdout } = await run(["stats", "--project", tmpDir]);
    expect(stdout).toContain("Episodes:    0");
    expect(stdout).toContain("Experiences: 0");
    expect(stdout).toContain("Patterns:    0");
    expect(stdout).toContain("Skills:      0");
  });

  it("skills list shows empty message", async () => {
    const origCwd = process.cwd();
    const { stdout } = await run(["skills", "list"], {
      EXP_LOOP_DATA_DIR: dataDir,
    });
    expect(stdout).toContain("No skills available");
  });

  it("sync command runs without errors on empty stores", async () => {
    const { stdout, stderr } = await run([
      "sync",
      "--scope",
      "project",
      "--project",
      tmpDir,
    ]);
    const combined = stdout + stderr;
    expect(combined).not.toContain("Cannot find module");
    expect(combined).not.toContain("FATAL");
  });

  it("observe warns when no API key is set", async () => {
    // Run from a temp cwd with NO .env and all key env vars cleared, so the
    // "no API key" path is actually exercised (the project .env would otherwise
    // supply a real key and skip the warning).
    const { stdout, stderr } = await execFileAsync(
      "node",
      [CLI, "observe", "--project", tmpDir, "--source", "claude-code"],
      {
        cwd: tmpDir,
        timeout: 15000,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
          CLAUDE_API_KEY: "",
          EXP_LOOP_DATA_DIR: dataDir,
        },
      },
    ).then(
      (r) => ({ stdout: r.stdout, stderr: r.stderr }),
      (err: any) => ({ stdout: err.stdout ?? "", stderr: err.stderr ?? "" }),
    );
    const combined = stdout + stderr;
    expect(combined).toContain("No API key found");
  });

  it("skills export fails gracefully for nonexistent skill", async () => {
    const { stderr } = await run(["skills", "export", "nonexistent", "--to", tmpDir], {
      EXP_LOOP_DATA_DIR: dataDir,
    });
    expect(stderr).toContain("not found");
  });

  describe("stats with pre-populated data", () => {
    it("counts episodes from the store", async () => {
      const episodesDir = join(dataDir, "episodes", "2026");
      await mkdir(episodesDir, { recursive: true });

      const episode = {
        id: "ep_test_1",
        task: { id: "t1", description: "test task" },
        status: "success",
        trace: { steps: [] },
        startedAt: "2026-06-01T10:00:00Z",
        endedAt: "2026-06-01T10:05:00Z",
      };
      await writeFile(
        join(episodesDir, "ep_test_1.json"),
        JSON.stringify(episode),
      );

      const { stdout } = await run(["stats", "--project", tmpDir]);
      expect(stdout).toContain("Episodes:    1");
      expect(stdout).toContain("success:   1");
    });
  });
});
