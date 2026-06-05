import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import type { Pattern, PatternStore } from "@exp-loop/core";

export class FileSystemPatternStore implements PatternStore {
  constructor(private baseDir: string) {}

  private get dir() {
    return join(this.baseDir, "patterns");
  }

  async save(pattern: Pattern): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, `${pattern.id}.json`),
      JSON.stringify(pattern, null, 2),
    );
  }

  async get(id: string): Promise<Pattern | null> {
    try {
      const data = await readFile(join(this.dir, `${id}.json`), "utf-8");
      return JSON.parse(data) as Pattern;
    } catch {
      return null;
    }
  }

  async list(): Promise<Pattern[]> {
    const files = await readdir(this.dir).catch(() => [] as string[]);
    const patterns: Pattern[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await readFile(join(this.dir, file), "utf-8");
      patterns.push(JSON.parse(data) as Pattern);
    }
    return patterns;
  }

  async update(id: string, patch: Partial<Pattern>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Pattern not found: ${id}`);
    const updated = { ...existing, ...patch };
    await this.save(updated);
  }
}
