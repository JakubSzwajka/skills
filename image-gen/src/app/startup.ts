import { invoke } from "@tauri-apps/api/core";

/**
 * Report the first interactive paint to the Rust side.
 *
 * Two nested requestAnimationFrame callbacks fire after the browser has
 * committed the first rendered frame, which is the closest monotonic
 * application marker for "visible and interactive" available to the
 * frontend. The Rust side computes elapsed time against its own process
 * start Instant, so the number is monotonic and never wall-clock based.
 */
export function reportFirstPaint(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      invoke<number>("report_first_paint")
        .then((elapsedMs) => {
          if (import.meta.env.DEV) {
            console.info(`startup: first paint at ${elapsedMs} ms`);
          }
        })
        .catch(() => {
          // Running in a plain browser (vite preview); nothing to report to.
        });
    });
  });
}
