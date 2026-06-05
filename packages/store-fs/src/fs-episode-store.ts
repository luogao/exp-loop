import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import type { Episode, EpisodeStore, EpisodeQuery } from "@exp-loop/core";

export class FileSystemEpisodeStore implements EpisodeStore {
  constructor(private baseDir: string) {}

  async save(episode: Episode): Promise<void> {
    const year = episode.startedAt.slice(0, 4);
    const dir = join(this.baseDir, "episodes", year);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${episode.id}.json`), JSON.stringify(episode, null, 2));
  }

  async get(id: string): Promise<Episode | null> {
    const episodesDir = join(this.baseDir, "episodes");
    const years = await readdir(episodesDir).catch(() => [] as string[]);
    for (const year of years) {
      const filePath = join(episodesDir, year, `${id}.json`);
      try {
        const data = await readFile(filePath, "utf-8");
        return JSON.parse(data) as Episode;
      } catch {
        continue;
      }
    }
    return null;
  }

  async list(query?: EpisodeQuery): Promise<Episode[]> {
    const episodes: Episode[] = [];
    const episodesDir = join(this.baseDir, "episodes");
    const years = await readdir(episodesDir).catch(() => [] as string[]);

    for (const year of years) {
      const dir = join(episodesDir, year);
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = await readFile(join(dir, file), "utf-8");
        const ep = JSON.parse(data) as Episode;
        if (query?.domain && ep.task.domain !== query.domain) continue;
        if (query?.taskType && ep.task.taskType !== query.taskType) continue;
        if (query?.status && ep.status !== query.status) continue;
        if (query?.after && ep.startedAt <= query.after) continue;
        episodes.push(ep);
      }
    }

    episodes.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    return query?.limit ? episodes.slice(0, query.limit) : episodes;
  }
}
