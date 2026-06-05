import { describe, it, expect } from "vitest";
import { createExpGuard } from "../src/exp-guard.js";
import { makeCandidate, makeExperience } from "./fixtures.js";

describe("ExpGuard", () => {
  const guard = createExpGuard();

  it("should accept a valid candidate", async () => {
    const result = await guard.evaluate(makeCandidate(), []);
    expect(result.decision).toBe("accept");
  });

  it("should reject low confidence", async () => {
    const result = await guard.evaluate(
      makeCandidate({ confidence: 0.3 }),
      [],
    );
    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("confidence");
  });

  it("should reject empty applyWhen", async () => {
    const result = await guard.evaluate(
      makeCandidate({ applyWhen: [] }),
      [],
    );
    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("applyWhen");
  });

  it("should reject short recommendation", async () => {
    const result = await guard.evaluate(
      makeCandidate({ recommendation: "Use X" }),
      [],
    );
    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("recommendation too short");
  });

  it("should reject purely negative recommendation", async () => {
    const result = await guard.evaluate(
      makeCandidate({
        recommendation:
          "Don't apply overflow scroll on sidebar containers ever",
      }),
      [],
    );
    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("purely negative");
  });

  it("should allow negative recommendation that includes positive action", async () => {
    const result = await guard.evaluate(
      makeCandidate({
        recommendation:
          "Don't use overflow scroll; use overflow hidden instead for sidebar containers",
      }),
      [],
    );
    expect(result.decision).toBe("accept");
  });

  it("should detect duplicate and return merge", async () => {
    const existing = [makeExperience()];
    const result = await guard.evaluate(makeCandidate(), existing);
    expect(result.decision).toBe("merge");
    expect(result.mergeTargetId).toBe("exp_test_001");
  });

  it("should not merge with deprecated experiences", async () => {
    const existing = [makeExperience({ status: "deprecated" })];
    const result = await guard.evaluate(makeCandidate(), existing);
    expect(result.decision).toBe("accept");
  });

  it("should respect custom config thresholds", async () => {
    const strictGuard = createExpGuard({
      minConfidence: 0.9,
      minRecommendationLength: 100,
    });
    const result = await strictGuard.evaluate(makeCandidate(), []);
    expect(result.decision).toBe("reject");
  });
});
