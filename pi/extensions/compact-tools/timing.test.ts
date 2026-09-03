import assert from "node:assert/strict";
import test from "node:test";
import { durationLabel, trackEnd, trackStart } from "./timing.ts";

test("a duration exists only once a row has both stamps", () => {
  trackStart("row");
  assert.equal(durationLabel("row"), undefined);
  trackEnd("row");
  assert.match(durationLabel("row")!, /^\d+\.\ds$/);
});

test("timing is keyed by the exact id, so a composed provider id cannot borrow it", () => {
  trackStart("call_x");
  trackEnd("call_x");
  assert.equal(durationLabel("call_x|fc_y"), undefined);
});

test("an end without a start reports nothing rather than guessing", () => {
  trackEnd("never-started");
  assert.equal(durationLabel("never-started"), undefined);
});
