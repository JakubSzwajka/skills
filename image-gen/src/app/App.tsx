import { useCallback, useEffect, useReducer, useState } from "react";
import * as api from "./api";
import type { AssetView, EffectiveSettings } from "./types";
import {
  galleryAssets,
  initialLibraryState,
  libraryReducer,
} from "./libraryReducer";
import { Composer } from "../generation/Composer";
import { BatchCard, type PreviewTarget } from "../history/BatchCard";
import { Preview } from "../preview/Preview";
import { SettingsView } from "../settings/SettingsView";

type Section = "latest" | "history" | "settings";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "latest", label: "Latest" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

interface ComposerState {
  open: boolean;
  seed: AssetView[];
}

export function App() {
  const [section, setSection] = useState<Section>("latest");
  const [library, dispatch] = useReducer(libraryReducer, initialLibraryState);
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  const [composer, setComposer] = useState<ComposerState>({
    open: false,
    seed: [],
  });
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyView, setHistoryView] = useState<"batches" | "gallery">(
    "batches",
  );

  // The shell renders first; history and settings load after first paint.
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

  const openComposer = useCallback((seed: AssetView[] = []) => {
    setComposer((current) => ({
      open: true,
      // Use-as-reference attaches to an already-open composer.
      seed: current.open
        ? [...current.seed, ...seed.filter((a) => !current.seed.some((s) => s.id === a.id))]
        : seed,
    }));
  }, []);

  const useAsReference = useCallback(
    (asset: AssetView) => {
      setPreview(null);
      openComposer([asset]);
    },
    [openComposer],
  );

  // Keyboard shortcuts: ⌘N composer, ⌘, settings, Escape closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "n") {
        event.preventDefault();
        openComposer();
      } else if (event.metaKey && event.key === ",") {
        event.preventDefault();
        setSection("settings");
      } else if (event.key === "Escape") {
        if (preview) setPreview(null);
        else setComposer({ open: false, seed: [] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openComposer, preview]);

  const loadMore = useCallback(() => {
    if (!library.nextCursor || loadingMore) return;
    setLoadingMore(true);
    api
      .loadHistoryPage(library.nextCursor)
      .then((page) => dispatch({ type: "pageLoaded", page }))
      .catch((reason) => console.error("history page failed:", reason))
      .finally(() => setLoadingMore(false));
  }, [library.nextCursor, loadingMore]);

  const latest = library.batches[0] ?? null;
  const gallery = galleryAssets(library);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Image Gen</h1>
        <button
          type="button"
          className="primary-button"
          onClick={() => openComposer()}
        >
          New generation
        </button>
      </header>
      <div className="app-body">
        <nav className="sidebar" aria-label="Sections">
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`sidebar-item${section === id ? " is-active" : ""}`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="content">
          {section === "latest" && (
            <>
              <section aria-labelledby="latest-heading">
                <h2 id="latest-heading" className="section-heading">
                  Latest batch
                </h2>
                {latest ? (
                  <BatchCard
                    batch={latest}
                    onPreview={setPreview}
                    onUseReference={useAsReference}
                  />
                ) : (
                  <div className="empty-state">
                    {library.hasLoaded
                      ? "No generations yet. Press ⌘N to create one."
                      : "Loading…"}
                  </div>
                )}
              </section>
              <section aria-labelledby="recent-heading">
                <h2 id="recent-heading" className="section-heading">
                  Recent images
                </h2>
                {gallery.length > 0 ? (
                  <div className="gallery-grid">
                    {gallery.map(({ asset, job }) => (
                      <button
                        key={asset.id}
                        type="button"
                        className="gallery-tile"
                        onClick={() => setPreview({ asset, job })}
                      >
                        <img
                          src={api.fileSrc(asset.thumbnailPath ?? asset.path)}
                          alt="Generated"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    Generated images will appear here.
                  </div>
                )}
              </section>
            </>
          )}

          {section === "history" && (
            <section aria-labelledby="history-heading">
              <div className="history-header">
                <h2 id="history-heading" className="section-heading">
                  History
                </h2>
                <div className="segmented">
                  {(
                    [
                      ["batches", "Batches"],
                      ["gallery", "Gallery"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`segment${historyView === id ? " is-selected" : ""}`}
                      onClick={() => setHistoryView(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {library.batches.length === 0 && (
                <div className="empty-state">
                  {library.hasLoaded ? "No generations yet." : "Loading…"}
                </div>
              )}
              {historyView === "batches" ? (
                library.batches.map((batch) => (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    onPreview={setPreview}
                    onUseReference={useAsReference}
                  />
                ))
              ) : (
                gallery.length > 0 && (
                  <div className="gallery-grid">
                    {gallery.map(({ asset, job }) => (
                      <button
                        key={asset.id}
                        type="button"
                        className="gallery-tile"
                        onClick={() => setPreview({ asset, job })}
                      >
                        <img
                          src={api.fileSrc(asset.thumbnailPath ?? asset.path)}
                          alt="Generated"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )
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
            </section>
          )}

          {section === "settings" &&
            (settings ? (
              <SettingsView settings={settings} onSaved={setSettings} />
            ) : (
              <div className="empty-state">Loading…</div>
            ))}
        </main>
      </div>

      {composer.open && (
        <Composer
          seedReferences={composer.seed}
          onClose={() => setComposer({ open: false, seed: [] })}
          onCreated={() => {
            setComposer({ open: false, seed: [] });
            setSection("latest");
          }}
        />
      )}
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
