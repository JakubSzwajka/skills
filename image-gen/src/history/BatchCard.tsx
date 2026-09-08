import * as api from "../app/api";
import type { AssetView, BatchView, JobView } from "../app/types";
import { PROVIDER_LABELS } from "../app/types";

export interface PreviewTarget {
  asset: AssetView;
  job: JobView | null;
}

interface BatchCardProps {
  batch: BatchView;
  onPreview: (target: PreviewTarget) => void;
  onUseReference: (asset: AssetView) => void;
}

export function BatchCard({ batch, onPreview, onUseReference }: BatchCardProps) {
  return (
    <article className="batch-card">
      <header className="batch-header">
        <p className="batch-prompt" title={batch.prompt}>
          {batch.prompt}
        </p>
        <time className="batch-time">
          {new Date(batch.createdAt).toLocaleString()}
        </time>
      </header>
      <div className="job-grid">
        {batch.jobs.map((job) => (
          <JobTile
            key={job.id}
            job={job}
            onPreview={onPreview}
            onUseReference={onUseReference}
          />
        ))}
      </div>
    </article>
  );
}

const STATUS_LABELS: Record<JobView["status"], string> = {
  queued: "Queued",
  running: "Running…",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

const ERROR_LABELS: Record<string, string> = {
  provider_unavailable: "Provider unavailable",
  authentication_required: "Login required",
  quota_exhausted: "Quota exhausted",
  backend_error: "Backend error",
  permission_denied: "Permission denied",
  timeout: "Timed out",
  invalid_output: "Invalid output",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  unknown: "Failed",
};

function JobTile({
  job,
  onPreview,
  onUseReference,
}: {
  job: JobView;
  onPreview: (target: PreviewTarget) => void;
  onUseReference: (asset: AssetView) => void;
}) {
  const asset = job.outputAsset;
  return (
    <div
      className={`job-tile status-${job.status}`}
      aria-label={`${PROVIDER_LABELS[job.provider]} image ${job.variantIndex + 1}: ${STATUS_LABELS[job.status]}`}
    >
      {job.status === "succeeded" && asset ? (
        <>
          <button
            type="button"
            className="job-image-button"
            onClick={() => onPreview({ asset, job })}
          >
            <img
              src={api.fileSrc(asset.thumbnailPath ?? asset.path)}
              alt={`${PROVIDER_LABELS[job.provider]} result ${job.variantIndex + 1}`}
              loading="lazy"
            />
          </button>
          <div className="job-meta">
            <span>
              {PROVIDER_LABELS[job.provider]} · {job.variantIndex + 1}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() => onUseReference(asset)}
            >
              Use as reference
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="job-placeholder" aria-live="polite">
            {job.status === "running" && <span className="spinner" aria-hidden />}
            <span className="job-status-label">
              {job.status === "failed" && job.errorCode
                ? ERROR_LABELS[job.errorCode]
                : STATUS_LABELS[job.status]}
            </span>
          </div>
          <div className="job-meta">
            <span>
              {PROVIDER_LABELS[job.provider]} · {job.variantIndex + 1}
            </span>
            {(job.status === "queued" || job.status === "running") && (
              <button
                type="button"
                className="link-button"
                onClick={() => api.cancelJob(job.id)}
              >
                Cancel
              </button>
            )}
            {(job.status === "failed" ||
              job.status === "cancelled" ||
              job.status === "interrupted") && (
              <button
                type="button"
                className="link-button"
                onClick={() => api.retryJob(job.id)}
              >
                Retry
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
