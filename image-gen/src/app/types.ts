// Mirrors the Rust domain types (serde camelCase).

export type Provider = "openai" | "antigravity";
export const ALL_PROVIDERS: Provider[] = ["openai", "antigravity"];
export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  antigravity: "Antigravity",
};

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ErrorCode =
  | "provider_unavailable"
  | "authentication_required"
  | "quota_exhausted"
  | "backend_error"
  | "permission_denied"
  | "timeout"
  | "invalid_output"
  | "cancelled"
  | "interrupted"
  | "unknown";

export interface AssetView {
  id: string;
  kind: "generated" | "reference";
  path: string;
  thumbnailPath: string | null;
  mediaType: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  createdAt: number;
}

export interface JobView {
  id: string;
  batchId: string;
  provider: Provider;
  variantIndex: number;
  status: JobStatus;
  retryOfJobId: string | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  outputAsset: AssetView | null;
}

export interface BatchView {
  id: string;
  prompt: string;
  variantCount: number;
  createdAt: number;
  jobs: JobView[];
  references: AssetView[];
}

export interface Cursor {
  createdAt: number;
  id: string;
}

export interface HistoryPage {
  batches: BatchView[];
  nextCursor: Cursor | null;
}

export interface StoredSettings {
  outputDir: string | null;
  codexPath: string | null;
  agyPath: string | null;
}

export interface EffectiveSettings {
  stored: StoredSettings;
  resolvedOutputDir: string;
  resolvedCodex: string | null;
  resolvedAgy: string | null;
}

export interface BootstrapResult {
  settings: EffectiveSettings;
  history: HistoryPage;
  recoveredJobs: number;
}

export interface CreateBatchInput {
  prompt: string;
  providers: Provider[];
  variantCount: number;
  referenceAssetIds: string[];
}
