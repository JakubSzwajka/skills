import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as api from "../app/api";
import type { AssetView, BatchView, Provider } from "../app/types";
import { ALL_PROVIDERS, PROVIDER_LABELS } from "../app/types";
import {
  canSubmit,
  generateLabel,
  jobCount,
  jobSummary,
  MAX_REFERENCES,
} from "./composerLogic";

interface ComposerProps {
  seedReferences: AssetView[];
  onSeedConsumed: () => void;
  onCreated: (batch: BatchView) => void;
}

export interface ComposerHandle {
  focusPrompt: () => void;
  scrollIntoView: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer({ seedReferences, onSeedConsumed, onCreated }, forwardedRef) {
    const [prompt, setPrompt] = useState("");
    const [providers, setProviders] = useState<Provider[]>([...ALL_PROVIDERS]);
    const [variantCount, setVariantCount] = useState(1);
    const [references, setReferences] = useState<AssetView[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);

    const addReferences = useCallback((assets: AssetView[]) => {
      setReferences((current) => {
        const unique = assets.filter(
          (asset) => !current.some((reference) => reference.id === asset.id),
        );
        const available = MAX_REFERENCES - current.length;
        if (unique.length > available) {
          setError(`At most ${MAX_REFERENCES} references per batch.`);
        }
        return [...current, ...unique.slice(0, available)];
      });
    }, []);

    useEffect(() => {
      if (seedReferences.length === 0) return;
      addReferences(seedReferences);
      onSeedConsumed();
    }, [addReferences, onSeedConsumed, seedReferences]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focusPrompt: () => promptRef.current?.focus(),
        scrollIntoView: () =>
          rootRef.current?.scrollIntoView({ block: "start" }),
      }),
      [],
    );

    useEffect(() => {
      const onPaste = (event: ClipboardEvent) => {
        const item = Array.from(event.clipboardData?.items ?? []).find((candidate) =>
          candidate.type.startsWith("image/"),
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
            addReferences([asset]);
          })
          .catch((reason) => setError(String(reason)));
      };
      window.addEventListener("paste", onPaste);
      return () => window.removeEventListener("paste", onPaste);
    }, [addReferences]);

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
          referenceAssetIds: references.map((reference) => reference.id),
        })
        .then((batch) => {
          setPrompt("");
          setReferences([]);
          setSubmitting(false);
          onCreated(batch);
        })
        .catch((reason) => {
          setError(String(reason));
          setSubmitting(false);
        });
    }, [submittable, prompt, providers, variantCount, references, onCreated]);

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
          ? current.filter((item) => item !== provider)
          : ALL_PROVIDERS.filter(
              (item) => current.includes(item) || item === provider,
            ),
      );
    };

    return (
      <div className="composer" ref={rootRef}>
        <h2 id="composer-heading" className="section-title">
          Make images
        </h2>

        <section className="composer-field" aria-labelledby="references-label">
          <h3 id="references-label" className="field-label">
            References
          </h3>
          <div className="reference-row">
            {references.map((reference) => (
              <div key={reference.id} className="reference-thumb">
                <img
                  src={api.fileSrc(reference.thumbnailPath ?? reference.path)}
                  alt="Generation reference"
                />
                <button
                  type="button"
                  className="reference-remove"
                  aria-label="Remove reference"
                  onClick={() =>
                    setReferences((current) =>
                      current.filter((item) => item.id !== reference.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            {references.length < MAX_REFERENCES && (
              <div className="reference-paste" aria-label="Paste an image with Command V">
                <span>Paste image</span>
                <kbd>⌘V</kbd>
              </div>
            )}
          </div>
        </section>

        <label className="composer-field" htmlFor="generation-prompt">
          <span className="field-label">Prompt</span>
          <textarea
            id="generation-prompt"
            ref={promptRef}
            className="prompt-input"
            value={prompt}
            rows={4}
            placeholder="Describe the image…"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        <div className="composer-options">
          <section className="choice-line" aria-labelledby="providers-label">
            <h3 id="providers-label" className="field-label">
              Providers
            </h3>
            <div className="toggle-group">
              {ALL_PROVIDERS.map((provider) => {
                const selected = providers.includes(provider);
                return (
                  <button
                    key={provider}
                    type="button"
                    className={`toggle-button${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => toggleProvider(provider)}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="choice-line" aria-labelledby="images-each-label">
            <h3 id="images-each-label" className="field-label">
              Images each
            </h3>
            <div className="count-control" role="group" aria-labelledby="images-each-label">
              {[1, 2, 3].map((number) => (
                <button
                  key={number}
                  type="button"
                  aria-pressed={variantCount === number}
                  className={`count-button${variantCount === number ? " is-selected" : ""}`}
                  onClick={() => setVariantCount(number)}
                >
                  {number}
                </button>
              ))}
            </div>
          </section>
        </div>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <p className="job-count">{jobSummary(providers, variantCount)}</p>
        <button
          type="button"
          className="primary-button generate-button"
          disabled={!submittable}
          aria-busy={submitting}
          onClick={submit}
        >
          {providers.length === 0
            ? "Choose a provider"
            : submitting
              ? "Starting…"
              : generateLabel(count)}
        </button>
        <p className="composer-help">
          <kbd>⌘ Enter</kbd> to generate
          <br />
          Jobs run one at a time per provider.
        </p>
      </div>
    );
  },
);
