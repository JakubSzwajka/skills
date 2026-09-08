import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as api from "../app/api";
import type { PreviewTarget } from "../history/BatchCard";
import type { AssetView } from "../app/types";

interface PreviewProps {
  target: PreviewTarget;
  onClose: () => void;
  onUseReference: (asset: AssetView) => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Preview({ target, onClose, onUseReference }: PreviewProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const { asset, job } = target;
  const [src, setSrc] = useState(() => api.fileSrc(asset.path));
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const invokingElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    closeButtonRef.current?.focus();

    return () => {
      if (invokingElement?.isConnected) {
        invokingElement.focus({ preventScroll: true });
      }
    };
  }, []);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusableElements = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (!firstElement || !lastElement) {
      event.preventDefault();
      panel.focus();
    } else if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

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
        ref={panelRef}
        className="preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="secondary-button preview-close"
          onClick={onClose}
        >
          Close
        </button>
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
