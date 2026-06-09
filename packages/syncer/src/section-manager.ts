import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const START_MARKER = "<!-- exp-loop:managed:start -->";
const END_MARKER = "<!-- exp-loop:managed:end -->";

const LEGACY_START = "<!-- exp-loop:start -->";
const LEGACY_END = "<!-- exp-loop:end -->";

function findMarkerLine(content: string, marker: string): number {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === marker) return content.indexOf(lines[i]);
  }
  return -1;
}

export function readManagedSection(content: string): string | null {
  let startIdx = findMarkerLine(content, START_MARKER);
  let endIdx = findMarkerLine(content, END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    startIdx = findMarkerLine(content, LEGACY_START);
    endIdx = findMarkerLine(content, LEGACY_END);
  }

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const markerLen = content.startsWith(START_MARKER, startIdx)
    ? START_MARKER.length
    : LEGACY_START.length;

  return content.slice(startIdx + markerLen, endIdx).trim();
}

export function writeManagedSection(
  existingContent: string,
  managedContent: string,
): string {
  const block = `${START_MARKER}\n${managedContent}\n${END_MARKER}`;

  let startIdx = findMarkerLine(existingContent, START_MARKER);
  let endMarker = END_MARKER;
  let endIdx = findMarkerLine(existingContent, END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    startIdx = findMarkerLine(existingContent, LEGACY_START);
    endIdx = findMarkerLine(existingContent, LEGACY_END);
    endMarker = LEGACY_END;
  }

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      existingContent.slice(0, startIdx) +
      block +
      existingContent.slice(endIdx + endMarker.length)
    );
  }

  if (existingContent.trim()) {
    return existingContent.trimEnd() + "\n\n" + block + "\n";
  }

  return block + "\n";
}

export async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function writeFileWithDir(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
