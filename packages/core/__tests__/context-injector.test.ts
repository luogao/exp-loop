import { describe, it, expect } from "vitest";
import { createContextInjector } from "../src/context-injector.js";
import { makeExperience } from "./fixtures.js";
import type { SkillSummary } from "../src/types.js";

describe("ContextInjector", () => {
  const experiences = [makeExperience()];
  const skills: SkillSummary[] = [
    {
      id: "skill_1",
      name: "frontend-bugfix-workflow",
      description: "Use when fixing frontend layout bugs",
      triggers: ["css", "layout"],
    },
  ];

  describe("markdown format", () => {
    const injector = createContextInjector({ format: "markdown" });

    it("should render experiences with When/Do/Not format", () => {
      const output = injector.render(experiences, []);
      expect(output).toContain("## Relevant Past Experiences");
      expect(output).toContain("**When:**");
      expect(output).toContain("**Do:**");
      expect(output).toContain("**Not:**");
      expect(output).toContain("overflow: hidden");
    });

    it("should render skill summaries", () => {
      const output = injector.render([], skills);
      expect(output).toContain("## Available Skills");
      expect(output).toContain("frontend-bugfix-workflow");
    });

    it("should return empty string when nothing to render", () => {
      const output = injector.render([], []);
      expect(output).toBe("");
    });
  });

  describe("xml format", () => {
    const injector = createContextInjector({ format: "xml" });

    it("should render valid XML structure", () => {
      const output = injector.render(experiences, skills);
      expect(output).toContain("<exp-loop-context>");
      expect(output).toContain("</exp-loop-context>");
      expect(output).toContain("<do>");
      expect(output).toContain("<when>");
      expect(output).toContain("<skill name=");
    });
  });

  describe("json format", () => {
    const injector = createContextInjector({ format: "json" });

    it("should output valid JSON", () => {
      const output = injector.render(experiences, skills);
      const parsed = JSON.parse(output);
      expect(parsed.experiences).toHaveLength(1);
      expect(parsed.skillSummaries).toHaveLength(1);
    });
  });
});
