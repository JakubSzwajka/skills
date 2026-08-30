// The only file that talks to Tauri. Tests mock this seam.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AssetView,
  BatchView,
  BootstrapResult,
  CreateBatchInput,
  Cursor,
  EffectiveSettings,
  HistoryPage,
  JobView,
  StoredSettings,
} from "./types";

export function bootstrap(): Promise<BootstrapResult> {
  return invoke("bootstrap");
}

export function createBatch(input: CreateBatchInput): Promise<BatchView> {
  return invoke("create_batch", { input });
}

export function cancelJob(jobId: string): Promise<void> {
  return invoke("cancel_job", { jobId });
}

export function retryJob(jobId: string): Promise<JobView> {
  return invoke("retry_job", { jobId });
}

export function loadHistoryPage(cursor: Cursor | null): Promise<HistoryPage> {
  return invoke("load_history_page", { cursor });
}

export function importReference(bytes: Uint8Array): Promise<AssetView> {
  return invoke("import_reference", bytes);
}

export function updateSettings(
  newSettings: StoredSettings,
): Promise<EffectiveSettings> {
  return invoke("update_settings", { newSettings });
}

export function copyImage(assetId: string): Promise<void> {
  return invoke("copy_image", { assetId });
}

export function revealAsset(assetId: string): Promise<void> {
  return invoke("reveal_asset", { assetId });
}

export function onJobUpdated(
  handler: (job: JobView) => void,
): Promise<UnlistenFn> {
  return listen<JobView>("job_updated", (event) => handler(event.payload));
}

export function onBatchCreated(
  handler: (batch: BatchView) => void,
): Promise<UnlistenFn> {
  return listen<BatchView>("batch_created", (event) => handler(event.payload));
}

/** Webview-loadable URL for a library file (thumbnail or original). */
export function fileSrc(path: string): string {
  return convertFileSrc(path);
}
