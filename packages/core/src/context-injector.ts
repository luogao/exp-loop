import type {
  Experience,
  SkillSummary,
  InjectorConfig,
  ContextInjector,
} from "./types.js";

export function createContextInjector(
  config: InjectorConfig = {},
): ContextInjector {
  const format = config.format ?? "markdown";

  return {
    render(experiences: Experience[], skillSummaries: SkillSummary[]): string {
      if (format === "xml") return renderXml(experiences, skillSummaries);
      if (format === "json")
        return JSON.stringify({ experiences, skillSummaries }, null, 2);
      return renderMarkdown(experiences, skillSummaries);
    },
  };
}

function renderMarkdown(
  experiences: Experience[],
  skillSummaries: SkillSummary[],
): string {
  const parts: string[] = [];

  if (experiences.length > 0) {
    parts.push("## Relevant Past Experiences\n");
    experiences.forEach((exp, i) => {
      parts.push(`### ${i + 1}. ${exp.title}\n`);
      parts.push(`**When:** ${exp.applyWhen.join("; ")}\n`);
      parts.push(`**Do:** ${exp.recommendation}\n`);
      if (exp.avoid?.length) {
        parts.push(`**Not:** ${exp.avoid.join("; ")}\n`);
      }
    });
  }

  if (skillSummaries.length > 0) {
    parts.push("## Available Skills\n");
    skillSummaries.forEach((s) => {
      parts.push(`- **${s.name}**: ${s.description}`);
    });
    parts.push("");
  }

  return parts.join("\n");
}

function renderXml(
  experiences: Experience[],
  skillSummaries: SkillSummary[],
): string {
  const parts: string[] = ["<exp-loop-context>"];

  if (experiences.length > 0) {
    parts.push("  <experiences>");
    experiences.forEach((exp) => {
      parts.push(`    <experience title="${escapeXml(exp.title)}">`);
      parts.push(`      <when>${escapeXml(exp.applyWhen.join("; "))}</when>`);
      parts.push(`      <do>${escapeXml(exp.recommendation)}</do>`);
      if (exp.avoid?.length) {
        parts.push(`      <not>${escapeXml(exp.avoid.join("; "))}</not>`);
      }
      parts.push("    </experience>");
    });
    parts.push("  </experiences>");
  }

  if (skillSummaries.length > 0) {
    parts.push("  <skills>");
    skillSummaries.forEach((s) => {
      parts.push(
        `    <skill name="${escapeXml(s.name)}">${escapeXml(s.description)}</skill>`,
      );
    });
    parts.push("  </skills>");
  }

  parts.push("</exp-loop-context>");
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
