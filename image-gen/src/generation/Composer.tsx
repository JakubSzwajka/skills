import { useCallback, useEffect, useState } from "react";
import * as api from "../app/api";
import type { AssetView, BatchView, Provider } from "../app/types";
import { ALL_PROVIDERS, PROVIDER_LABELS } from "../app/types";
import { canSubmit, generateLabel, jobCount, MAX_REFERENCES } from "./composerLogic";

interface ComposerProps {
  seedReferences: AssetView[];
  onClose: () => void;
  onCreated: (batch: BatchView) => void;
}

export function Composer({ seedReferences, onClose, onCreated }: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState<Provider[]>([...ALL_PROVIDERS]);
  const [variantCount, setVariantCount] = useState(1);
  const [references, setReferences] = useState<AssetView[]>(seedReferences);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const addReference = useCallback((asset: AssetView) => {
    setReferences((current) => {
      if (current.some((r) => r.id === asset.id)) return current;
      if (current.length >= MAX_REFERENCES) {
        setError(`At most ${MAX_REFERENCES} references per batch.`);
        return current;
      }
      return [...current, asset];
    });
  }, []);

  // Paste a reference while the composer is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!item) return;
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      file
        .arrayBuffer()
        .then((buffer) => api.importReference(new Uint8Array(buffer)))
        .then((asset) => {
          setError(null);
          addReference(asset);
        })
        .catch((reason) => setError(String(reason)));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addReference]);

  const count = jobCount(providers, variantCount);
  const submittable =
    canSubmit({
      prompt,
      providers,
      variantCount,
      referenceCount: references.length,
    }) && !submitting;

  const submit = useCallback(() => {
    if (!submittable) return;
    setSubmitting(true);
    setError(null);
    api
      .createBatch({
        prompt: prompt.trim(),
        providers,
        variantCount,
        referenceAssetIds: references.map((r) => r.id),
      })
      .then((batch) => onCreated(batch))
      .catch((reason) => {
        setError(String(reason));
        setSubmitting(false);
      });
  }, [submittable, prompt, providers, variantCount, references, onCreated]);

  // Command+Enter submits.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const toggleProvider = (provider: Provider) => {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((p) => p !== provider)
        : [...ALL_PROVIDERS.filter((p) => current.includes(p) || p === provider)],
    );
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="New generation"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <h2 className="sheet-title">New generation</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="sheet-section">
          <h3 className="field-label">References</h3>
          <div className="reference-row">
            {references.map((reference) => (
              <div key={reference.id} className="reference-thumb">
                <img
                  src={api.fileSrc(reference.thumbnailPath ?? reference.path)}
                  alt="Reference"
                />
                <button
                  type="button"
                  className="reference-remove"
                  aria-label="Remove reference"
                  onClick={() =>
                    setReferences((current) =>
                      current.filter((r) => r.id !== reference.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="reference-hint">
              {references.length === 0
                ? "Paste an image (⌘V) or use one from history."
                : "Paste to add more."}
            </div>
          </div>
        </section>

        <section className="sheet-section">
          <h3 className="field-label">Prompt</h3>
          <textarea
            className="prompt-input"
            value={prompt}
            autoFocus
            rows={4}
            placeholder="Describe the image…"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </section>

        <section className="sheet-section sheet-options">
          <div>
            <h3 className="field-label">Providers</h3>
            <div className="segmented">
              {ALL_PROVIDERS.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className={`segment${providers.includes(provider) ? " is-selected" : ""}`}
                  onClick={() => toggleProvider(provider)}
                >
                  {PROVIDER_LABELS[provider]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="field-label">Variants</h3>
            <div className="segmented">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`segment${variantCount === n ? " is-selected" : ""}`}
                  onClick={() => setVariantCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </section>

        {error && <div className="form-error">{error}</div>}

        <footer className="sheet-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!submittable}
            onClick={submit}
          >
            {generateLabel(count)}
          </button>
        </footer>
      </div>
    </div>
  );
}
