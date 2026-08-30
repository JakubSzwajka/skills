import { useState } from "react";
import * as api from "../app/api";
import type { PreviewTarget } from "../history/BatchCard";
import type { AssetView } from "../app/types";

interface PreviewProps {
  target: PreviewTarget;
  onClose: () => void;
  onUseReference: (asset: AssetView) => void;
}

export function Preview({ target, onClose, onUseReference }: PreviewProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const { asset, job } = target;
  const [src, setSrc] = useState(() => api.fileSrc(asset.path));

  // If the original cannot be loaded, fall back to the thumbnail so the
  // preview is never an empty box.
  const onImageError = () => {
    const fallback = asset.thumbnailPath ? api.fileSrc(asset.thumbnailPath) : null;
    if (fallback && src !== fallback) {
      setSrc(fallback);
      setNotice("Showing thumbnail — the original could not be loaded.");
    } else {
      setNotice(`Image file could not be loaded: ${asset.path}`);
    }
  };

  const copy = () => {
    api
      .copyImage(asset.id)
      .then(() => setNotice("Copied"))
      .catch((reason) => setNotice(String(reason)));
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="preview-panel"
        role="dialog"
        aria-label="Image preview"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          className="preview-image"
          src={src}
          onError={onImageError}
          alt="Generated preview"
        />
        <footer className="preview-actions">
          <button type="button" className="secondary-button" onClick={copy}>
            Copy image
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => api.revealAsset(asset.id)}
          >
            Reveal in Finder
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onUseReference(asset)}
          >
            Use as reference
          </button>
          {job && job.status !== "queued" && job.status !== "running" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                api.retryJob(job.id);
                onClose();
              }}
            >
              Retry generation
            </button>
          )}
          {notice && <span className="preview-notice">{notice}</span>}
        </footer>
      </div>
    </div>
  );
}
