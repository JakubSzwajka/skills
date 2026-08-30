// Pure state transitions for the batch/job library. New batches prepend;
// pages append without duplicates; job events upsert in place.

import type { BatchView, Cursor, HistoryPage, JobView } from "./types";

export interface LibraryState {
  batches: BatchView[];
  nextCursor: Cursor | null;
  hasLoaded: boolean;
}

export const initialLibraryState: LibraryState = {
  batches: [],
  nextCursor: null,
  hasLoaded: false,
};

export type LibraryAction =
  | { type: "bootstrap"; page: HistoryPage }
  | { type: "pageLoaded"; page: HistoryPage }
  | { type: "batchCreated"; batch: BatchView }
  | { type: "jobUpdated"; job: JobView };

export function libraryReducer(
  state: LibraryState,
  action: LibraryAction,
): LibraryState {
  switch (action.type) {
    case "bootstrap":
      return {
        batches: action.page.batches,
        nextCursor: action.page.nextCursor,
        hasLoaded: true,
      };
    case "pageLoaded": {
      const known = new Set(state.batches.map((b) => b.id));
      const fresh = action.page.batches.filter((b) => !known.has(b.id));
      return {
        ...state,
        batches: [...state.batches, ...fresh],
        nextCursor: action.page.nextCursor,
      };
    }
    case "batchCreated": {
      if (state.batches.some((b) => b.id === action.batch.id)) {
        return {
          ...state,
          batches: state.batches.map((b) =>
            b.id === action.batch.id ? action.batch : b,
          ),
        };
      }
      // Prepending does not disturb an older page's cursor.
      return { ...state, batches: [action.batch, ...state.batches] };
    }
    case "jobUpdated": {
      const { job } = action;
      return {
        ...state,
        batches: state.batches.map((batch) => {
          if (batch.id !== job.batchId) return batch;
          const exists = batch.jobs.some((j) => j.id === job.id);
          const jobs = exists
            ? batch.jobs.map((j) => (j.id === job.id ? job : j))
            : [...batch.jobs, job].sort(compareJobs);
          return { ...batch, jobs };
        }),
      };
    }
  }
}

function compareJobs(a: JobView, b: JobView): number {
  if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
  if (a.variantIndex !== b.variantIndex) return a.variantIndex - b.variantIndex;
  return a.createdAt - b.createdAt;
}

/** Succeeded output assets across loaded batches, newest first. */
export function galleryAssets(state: LibraryState) {
  return state.batches.flatMap((batch) =>
    batch.jobs
      .filter((job) => job.status === "succeeded" && job.outputAsset)
      .map((job) => ({ asset: job.outputAsset!, job, batch })),
  );
}
