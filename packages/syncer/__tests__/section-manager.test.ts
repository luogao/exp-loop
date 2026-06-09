import { describe, it, expect } from "vitest";
import {
  readManagedSection,
  writeManagedSection,
} from "../src/section-manager.js";

describe("readManagedSection", () => {
  it("returns content between markers", () => {
    const content = `# My Project

<!-- exp-loop:managed:start -->
## Learned Experiences
Some content here
<!-- exp-loop:managed:end -->

Other stuff`;

    const section = readManagedSection(content);
    expect(section).toBe("## Learned Experiences\nSome content here");
  });

  it("returns null when markers are missing", () => {
    expect(readManagedSection("# Just a normal file")).toBeNull();
  });

  it("returns null when only start marker exists", () => {
    expect(readManagedSection("<!-- exp-loop:managed:start -->\ncontent")).toBeNull();
  });
});

describe("writeManagedSection", () => {
  it("replaces content between existing markers", () => {
    const existing = `# Project

<!-- exp-loop:managed:start -->
old content
<!-- exp-loop:managed:end -->

Footer`;

    const result = writeManagedSection(existing, "new content");
    expect(result).toContain("new content");
    expect(result).not.toContain("old content");
    expect(result).toContain("Footer");
    expect(result).toContain("# Project");
  });

  it("appends to existing file without markers", () => {
    const existing = "# My Project\n\nSome docs here.";
    const result = writeManagedSection(existing, "managed content");
    expect(result).toContain("# My Project");
    expect(result).toContain("Some docs here.");
    expect(result).toContain("<!-- exp-loop:managed:start -->");
    expect(result).toContain("managed content");
    expect(result).toContain("<!-- exp-loop:managed:end -->");
  });

  it("creates content for empty file", () => {
    const result = writeManagedSection("", "managed content");
    expect(result).toContain("<!-- exp-loop:managed:start -->");
    expect(result).toContain("managed content");
    expect(result).toContain("<!-- exp-loop:managed:end -->");
  });

  it("preserves content outside markers", () => {
    const existing = `Header

<!-- exp-loop:managed:start -->
old
<!-- exp-loop:managed:end -->

Footer`;

    const result = writeManagedSection(existing, "new");
    expect(result).toContain("Header");
    expect(result).toContain("Footer");
    expect(result).toContain("new");
    expect(result).not.toContain("old");
  });

  it("migrates legacy markers to new format", () => {
    const existing = `# Project

<!-- exp-loop:start -->
legacy content
<!-- exp-loop:end -->

Footer`;

    const result = writeManagedSection(existing, "new content");
    expect(result).toContain("<!-- exp-loop:managed:start -->");
    expect(result).toContain("new content");
    expect(result).toContain("<!-- exp-loop:managed:end -->");
    expect(result).not.toContain("legacy content");
    expect(result).toContain("Footer");
  });

  it("does not match markers inside content text", () => {
    const existing = `# Project

<!-- exp-loop:managed:start -->
Some experience about using exp-loop:start markers
<!-- exp-loop:managed:end -->`;

    const result = writeManagedSection(existing, "updated");
    expect(result).toContain("updated");
    const startCount = (result.match(/<!-- exp-loop:managed:start -->/g) || []).length;
    const endCount = (result.match(/<!-- exp-loop:managed:end -->/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });
});
