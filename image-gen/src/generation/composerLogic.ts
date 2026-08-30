// Pure composer rules. Mirrors the Rust-side limits.

import type { Provider } from "../app/types";

export const MAX_REFERENCES = 8;
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export function jobCount(providers: Provider[], variantCount: number): number {
  return providers.length * variantCount;
}

export function generateLabel(count: number): string {
  return count === 1 ? "Generate 1 image" : `Generate ${count} images`;
}

export function canSubmit(input: {
  prompt: string;
  providers: Provider[];
  variantCount: number;
  referenceCount: number;
}): boolean {
  return (
    input.prompt.trim().length > 0 &&
    input.providers.length > 0 &&
    input.variantCount >= 1 &&
    input.variantCount <= 3 &&
    input.referenceCount <= MAX_REFERENCES
  );
}
