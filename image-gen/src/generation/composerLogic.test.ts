import { describe, expect, it } from "vitest";
import {
  canSubmit,
  generateLabel,
  jobCount,
  jobSummary,
} from "./composerLogic";

describe("jobCount", () => {
  it("multiplies providers by variants", () => {
    expect(jobCount(["openai", "antigravity"], 3)).toBe(6);
    expect(jobCount(["openai"], 1)).toBe(1);
    expect(jobCount([], 3)).toBe(0);
  });
});

describe("generateLabel", () => {
  it("makes quota use clear before submission", () => {
    expect(generateLabel(6)).toBe("Generate 6 images");
    expect(generateLabel(1)).toBe("Generate 1 image");
  });
});

describe("jobSummary", () => {
  it("describes the provider, image, and job totals", () => {
    expect(jobSummary(["openai", "antigravity"], 2)).toBe(
      "2 providers × 2 images · 4 jobs",
    );
    expect(jobSummary(["openai"], 1)).toBe(
      "1 provider × 1 image · 1 job",
    );
    expect(jobSummary([], 3)).toBe("0 providers × 3 images · 0 jobs");
  });
});

describe("canSubmit", () => {
  const valid = {
    prompt: "a potato",
    providers: ["openai"] as ("openai" | "antigravity")[],
    variantCount: 2,
    referenceCount: 0,
  };

  it("accepts a valid selection", () => {
    expect(canSubmit(valid)).toBe(true);
  });

  it("rejects empty prompt, no providers, bad variants, too many refs", () => {
    expect(canSubmit({ ...valid, prompt: "   " })).toBe(false);
    expect(canSubmit({ ...valid, providers: [] })).toBe(false);
    expect(canSubmit({ ...valid, variantCount: 0 })).toBe(false);
    expect(canSubmit({ ...valid, variantCount: 4 })).toBe(false);
    expect(canSubmit({ ...valid, referenceCount: 9 })).toBe(false);
  });
});
