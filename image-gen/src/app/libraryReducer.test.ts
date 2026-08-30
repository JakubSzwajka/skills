import { describe, expect, it } from "vitest";
import {
  galleryAssets,
  initialLibraryState,
  libraryReducer,
  type LibraryState,
} from "./libraryReducer";
import type { AssetView, BatchView, JobView } from "./types";

let counter = 0;

function makeJob(overrides: Partial<JobView> = {}): JobView {
  counter += 1;
  return {
    id: `job-${counter}`,
    batchId: "batch-1",
    provider: "openai",
    variantIndex: 0,
    status: "queued",
    retryOfJobId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: counter,
    startedAt: null,
    finishedAt: null,
    outputAsset: null,
    ...overrides,
  };
}

function makeAsset(id: string): AssetView {
  return {
    id,
    kind: "generated",
    path: `/out/${id}.png`,
    thumbnailPath: `/thumbs/${id}.webp`,
    mediaType: "image/png",
    width: 10,
    height: 10,
    byteSize: 100,
    sha256: id,
    createdAt: 1,
  };
}

function makeBatch(id: string, jobs: JobView[] = []): BatchView {
  counter += 1;
  return {
    id,
    prompt: `prompt ${id}`,
    variantCount: 1,
    createdAt: counter,
    jobs,
    references: [],
  };
}

function withBatches(...batches: BatchView[]): LibraryState {
  return { batches, nextCursor: null, hasLoaded: true };
}

describe("libraryReducer", () => {
  it("prepends new batches and replaces duplicates from the event race", () => {
    const a = makeBatch("a");
    const b = makeBatch("b");
    let state = libraryReducer(withBatches(a), { type: "batchCreated", batch: b });
    expect(state.batches.map((x) => x.id)).toEqual(["b", "a"]);
    // The command response and the event may both deliver the batch.
    state = libraryReducer(state, { type: "batchCreated", batch: b });
    expect(state.batches.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("appends pages without duplicates", () => {
    const a = makeBatch("a");
    const b = makeBatch("b");
    const c = makeBatch("c");
    const state = libraryReducer(withBatches(a, b), {
      type: "pageLoaded",
      page: { batches: [b, c], nextCursor: { createdAt: 1, id: "c" } },
    });
    expect(state.batches.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(state.nextCursor?.id).toBe("c");
  });

  it("updates a job in place", () => {
    const job = makeJob({ batchId: "a" });
    const state = libraryReducer(withBatches(makeBatch("a", [job])), {
      type: "jobUpdated",
      job: { ...job, status: "running", startedAt: 5 },
    });
    expect(state.batches[0].jobs[0].status).toBe("running");
    expect(state.batches[0].jobs).toHaveLength(1);
  });

  it("inserts a retry job sorted next to its provider variants", () => {
    const first = makeJob({ batchId: "a", provider: "antigravity" });
    const second = makeJob({ batchId: "a", provider: "openai" });
    const state = withBatches(makeBatch("a", [first, second]));
    const retry = makeJob({
      batchId: "a",
      provider: "antigravity",
      retryOfJobId: first.id,
    });
    const next = libraryReducer(state, { type: "jobUpdated", job: retry });
    expect(next.batches[0].jobs).toHaveLength(3);
    const providers = next.batches[0].jobs.map((j) => j.provider);
    expect(providers).toEqual(["antigravity", "antigravity", "openai"]);
  });

  it("starts empty until bootstrap arrives", () => {
    expect(initialLibraryState.hasLoaded).toBe(false);
    const state = libraryReducer(initialLibraryState, {
      type: "bootstrap",
      page: { batches: [makeBatch("a")], nextCursor: null },
    });
    expect(state.hasLoaded).toBe(true);
    expect(state.batches).toHaveLength(1);
  });
});

describe("galleryAssets", () => {
  it("collects only succeeded jobs with outputs", () => {
    const done = makeJob({
      batchId: "a",
      status: "succeeded",
      outputAsset: makeAsset("x"),
    });
    const failed = makeJob({ batchId: "a", status: "failed" });
    const state = withBatches(makeBatch("a", [done, failed]));
    const gallery = galleryAssets(state);
    expect(gallery).toHaveLength(1);
    expect(gallery[0].asset.id).toBe("x");
  });
});
