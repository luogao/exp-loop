import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sourceMethods } from "../src/methods/sources.js";
import { detectSources, resolveCredentials } from "../src/config.js";

const noop = () => {};

describe("sources.detect", () => {
  it("returns a list of sources with availability", async () => {
    const methods = sourceMethods();
    const result = (await methods["sources.detect"]({}, noop)) as Array<{
      id: string;
      name: string;
      available: boolean;
    }>;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(4);

    const ids = result.map((s) => s.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex");
    expect(ids).toContain("gemini");
    expect(ids).toContain("hermes");

    for (const source of result) {
      expect(source).toHaveProperty("id");
      expect(source).toHaveProperty("name");
      expect(source).toHaveProperty("dataDir");
      expect(typeof source.available).toBe("boolean");
    }
  });
});

describe("config.resolveCredentials", () => {
  it("returns credential options including manual", async () => {
    const methods = sourceMethods();
    const result = (await methods["config.resolveCredentials"](
      {},
      noop,
    )) as Array<{
      source: string;
      label: string;
      available: boolean;
    }>;

    expect(Array.isArray(result)).toBe(true);

    const manual = result.find((c) => c.source === "manual");
    expect(manual).toBeDefined();
    expect(manual!.available).toBe(true);

    const sources = result.map((c) => c.source);
    expect(sources).toContain("env");
    expect(sources).toContain("codex");
    expect(sources).toContain("hermes");
  });
});

describe("detectSources", () => {
  it("always returns 4 sources", async () => {
    const sources = await detectSources();
    expect(sources).toHaveLength(4);
    expect(sources[0].id).toBe("claude-code");
    expect(sources[1].id).toBe("codex");
    expect(sources[2].id).toBe("gemini");
    expect(sources[3].id).toBe("hermes");
  });
});

describe("resolveCredentials", () => {
  it("manual is always available", async () => {
    const creds = await resolveCredentials();
    const manual = creds.find((c) => c.source === "manual");
    expect(manual).toBeDefined();
    expect(manual!.available).toBe(true);
  });

  it("masks key previews", async () => {
    const creds = await resolveCredentials();
    for (const cred of creds) {
      if (cred.keyPreview) {
        expect(cred.keyPreview).toMatch(/\.\.\./);
        expect(cred.keyPreview.length).toBeLessThan(20);
      }
    }
  });
});
