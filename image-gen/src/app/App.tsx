import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as api from "./api";
import type { AssetView, EffectiveSettings } from "./types";
import { PROVIDER_LABELS } from "./types";
import {
  galleryAssets,
  initialLibraryState,
  libraryReducer,
} from "./libraryReducer";
import { Composer, type ComposerHandle } from "../generation/Composer";
import { BatchCard, type PreviewTarget } from "../history/BatchCard";
import { Preview } from "../preview/Preview";
import { SettingsView } from "../settings/SettingsView";

type Section = "library" | "settings";
type LibraryView = "images" | "batches";

export function App() {
  const [section, setSection] = useState<Section>("library");
  const [libraryView, setLibraryView] = useState<LibraryView>("images");
  const [library, dispatch] = useReducer(libraryReducer, initialLibraryState);
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  const [composerSeed, setComposerSeed] = useState<AssetView[]>([]);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);

  // Loading after first paint keeps native window startup responsive.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    api
      .bootstrap()
      .then((result) => {
        if (disposed) return;
        setSettings(result.settings);
        dispatch({ type: "bootstrap", page: result.history });
      })
      .catch((reason) => console.error("bootstrap failed:", reason));
    api.onJobUpdated((job) => dispatch({ type: "jobUpdated", job })).then(
      (unlisten) => unlisteners.push(unlisten),
    );
    api
      .onBatchCreated((batch) => dispatch({ type: "batchCreated", batch }))
      .then((unlisten) => unlisteners.push(unlisten));
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const focusComposer = useCallback(() => {
    composerRef.current?.focusPrompt();
    composerRef.current?.scrollIntoView();
  }, []);

  const showLibrary = useCallback((view: LibraryView = "images") => {
    setSection("library");
    setLibraryView(view);
  }, []);

  const useAsReference = useCallback(
    (asset: AssetView) => {
      setPreview(null);
      setSection("library");
      setComposerSeed((current) =>
        current.some((reference) => reference.id === asset.id)
          ? current
          : [...current, asset],
      );
      requestAnimationFrame(focusComposer);
    },
    [focusComposer],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "n") {
        event.preventDefault();
        setSection("library");
        requestAnimationFrame(focusComposer);
      } else if (event.metaKey && event.key === ",") {
        event.preventDefault();
        setSection("settings");
      } else if (event.key === "Escape" && preview) {
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusComposer, preview]);

  const loadMore = useCallback(() => {
    if (!library.nextCursor || loadingMore) return;
    setLoadingMore(true);
    api
      .loadHistoryPage(library.nextCursor)
      .then((page) => dispatch({ type: "pageLoaded", page }))
      .catch((reason) => console.error("history page failed:", reason))
      .finally(() => setLoadingMore(false));
  }, [library.nextCursor, loadingMore]);

  const gallery = galleryAssets(library);
  const promptByBatch = useMemo(
    () => new Map(library.batches.map((batch) => [batch.id, batch.prompt])),
    [library.batches],
  );

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="brand-button"
          onClick={() => showLibrary("images")}
          aria-label="Open image library"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>Image Gen</span>
        </button>
        <nav className="app-tools" aria-label="Primary">
          <button
            type="button"
            className={section === "library" && libraryView === "batches" ? "is-active" : ""}
            aria-current={section === "library" && libraryView === "batches" ? "page" : undefined}
            onClick={() => showLibrary("batches")}
          >
            History
          </button>
          <button
            type="button"
            className={section === "settings" ? "is-active" : ""}
            aria-current={section === "settings" ? "page" : undefined}
            onClick={() => setSection("settings")}
          >
            Settings
          </button>
        </nav>
      </header>

      <div className="studio-layout">
        <aside className="studio-rail" aria-labelledby="composer-heading">
          <Composer
            ref={composerRef}
            seedReferences={composerSeed}
            onSeedConsumed={() => setComposerSeed([])}
            onCreated={() => showLibrary("batches")}
          />
        </aside>

        <main className="studio-library">
          {section === "library" ? (
            <>
              <header className="library-heading">
                <div>
                  <h1 className="section-title">Library</h1>
                  <p className="section-subtitle">
                    {gallery.length} {gallery.length === 1 ? "image" : "images"} · newest first
                  </p>
                </div>
                <div className="view-switch" aria-label="Library view">
                  <button
                    type="button"
                    aria-pressed={libraryView === "images"}
                    onClick={() => setLibraryView("images")}
                  >
                    Images
                  </button>
                  <button
                    type="button"
                    aria-pressed={libraryView === "batches"}
                    onClick={() => setLibraryView("batches")}
                  >
                    Batches
                  </button>
                </div>
              </header>

              {!library.hasLoaded ? (
                <div className="contact-sheet loading-sheet" aria-label="Loading library" aria-busy="true">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div className="loading-tile" key={index} aria-hidden="true" />
                  ))}
                </div>
              ) : libraryView === "images" ? (
                gallery.length > 0 ? (
                  <div className="contact-sheet">
                    {gallery.map(({ asset, job }) => (
                      <article className="contact-item" key={asset.id}>
                        <button
                          type="button"
                          className="contact-image"
                          onClick={() => setPreview({ asset, job })}
                        >
                          <img
                            src={api.fileSrc(asset.thumbnailPath ?? asset.path)}
                            alt={`${PROVIDER_LABELS[job.provider]} result ${job.variantIndex + 1}`}
                            loading="lazy"
                          />
                        </button>
                        <div className="contact-caption">
                          <span className="contact-title" title={promptByBatch.get(job.batchId)}>
                            {promptByBatch.get(job.batchId) ?? "Generated image"}
                          </span>
                          <span className="contact-provider">
                            <i aria-hidden="true" />
                            {PROVIDER_LABELS[job.provider]}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="contact-reference-action"
                          onClick={() => useAsReference(asset)}
                        >
                          Use as reference
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Generated images will appear here.</div>
                )
              ) : library.batches.length > 0 ? (
                <div className="batch-list" aria-live="polite">
                  {library.batches.map((batch) => (
                    <BatchCard
                      key={batch.id}
                      batch={batch}
                      onPreview={setPreview}
                      onUseReference={useAsReference}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">No generations yet.</div>
              )}

              {library.nextCursor && (
                <button
                  type="button"
                  className="secondary-button load-more"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          ) : (
            <>
              <header className="library-heading">
                <div>
                  <h1 className="section-title">Settings</h1>
                  <p className="section-subtitle">Storage and provider executables</p>
                </div>
              </header>
              {settings ? (
                <SettingsView settings={settings} onSaved={setSettings} />
              ) : (
                <div className="empty-state">Loading…</div>
              )}
            </>
          )}
        </main>
      </div>

      {preview && (
        <Preview
          key={preview.asset.id}
          target={preview}
          onClose={() => setPreview(null)}
          onUseReference={useAsReference}
        />
      )}
    </div>
  );
}
