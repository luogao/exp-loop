import { createExpRetriever, createContextInjector, generateId } from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const input = await readStdin();
  const data = JSON.parse(input);
  const prompt: string = data.prompt || "";
  const cwd: string = data.cwd || process.cwd();

  if (!prompt.trim()) {
    process.exit(0);
  }

  const dataDir = resolve(cwd, ".exp-loop");
  const stores = createFileSystemStores(dataDir);
  const retriever = createExpRetriever({ store: stores.experienceStore, topK: 5 });
  const injector = createContextInjector({ format: "markdown" });

  const task = {
    id: generateId("task"),
    description: prompt,
  };

  const experiences = await retriever.retrieve({ task });

  if (experiences.length === 0) {
    process.exit(0);
  }

  const summaries = await stores.skillRegistry.listSummaries();
  const promptBlock = injector.render(experiences, summaries);

  if (promptBlock.trim()) {
    process.stdout.write(promptBlock);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

main().catch(() => process.exit(1));
