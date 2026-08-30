import assert from "node:assert/strict"
import test from "node:test"
import {
  durationLabel,
  parseClaudeLimits,
  parseCodexLimits,
  parseOpenRouterLimits,
} from "./model.ts"

test("durationLabel derives provider windows instead of assuming them", () => {
  assert.equal(durationLabel(18_000), "5-hour")
  assert.equal(durationLabel(604_800), "Weekly")
  assert.equal(durationLabel(86_400), "1-day")
})

test("parseCodexLimits includes base and model-specific windows", () => {
  const result = parseCodexLimits({
    plan_type: "prolite",
    rate_limit: {
      primary_window: {
        used_percent: 11,
        limit_window_seconds: 604_800,
        reset_at: 1_788_680_989,
      },
      secondary_window: null,
    },
    additional_rate_limits: [
      {
        limit_name: "GPT-5.3-Codex-Spark",
        rate_limit: {
          primary_window: {
            used_percent: 20,
            limit_window_seconds: 18_000,
            reset_at: 1_788_121_043,
          },
          secondary_window: {
            used_percent: 30,
            limit_window_seconds: 604_800,
            reset_at: 1_788_707_843,
          },
        },
      },
    ],
  })

  assert.equal(result.subtitle, "Prolite")
  assert.deepEqual(result.windows.map(({ label, usedPercent }) => ({ label, usedPercent })), [
    { label: "Weekly", usedPercent: 11 },
    { label: "GPT-5.3-Codex-Spark · 5-hour", usedPercent: 20 },
    { label: "GPT-5.3-Codex-Spark · Weekly", usedPercent: 30 },
  ])
  assert.equal(result.windows[0]?.resetAt, 1_788_680_989_000)
})

test("parseClaudeLimits uses named scoped limits, including Fable", () => {
  const result = parseClaudeLimits({
    limits: [
      {
        kind: "session",
        percent: 70,
        resets_at: "2026-08-30T19:29:59.544859+00:00",
      },
      {
        kind: "weekly_all",
        percent: 25,
        resets_at: "2026-09-02T00:59:59.544881+00:00",
      },
      {
        kind: "weekly_scoped",
        percent: 17,
        resets_at: "2026-09-02T00:59:59.545161+00:00",
        scope: { model: { display_name: "Fable" } },
      },
    ],
    extra_usage: { is_enabled: false },
  })

  assert.deepEqual(result.windows.map(({ label, usedPercent }) => ({ label, usedPercent })), [
    { label: "5-hour session", usedPercent: 70 },
    { label: "Weekly all models", usedPercent: 25 },
    { label: "Weekly Fable", usedPercent: 17 },
  ])
  assert.deepEqual(result.notes, ["Extra usage: off"])
})

test("parseClaudeLimits falls back to legacy Opus and Sonnet buckets", () => {
  const result = parseClaudeLimits({
    five_hour: { utilization: 10, resets_at: "2026-08-30T19:00:00Z" },
    seven_day: { utilization: 20, resets_at: "2026-09-02T00:00:00Z" },
    seven_day_opus: { utilization: 30, resets_at: "2026-09-02T00:00:00Z" },
    seven_day_sonnet: null,
  })

  assert.deepEqual(result.windows.map(({ label }) => label), [
    "5-hour session",
    "Weekly all models",
    "Weekly Opus",
  ])
})

test("parseOpenRouterLimits reports spend limit and credits", () => {
  const result = parseOpenRouterLimits(
    { data: { usage: 15, limit: 60, limit_reset: "daily" } },
    { data: { total_credits: 100, total_usage: 40 } },
  )

  assert.deepEqual(result.windows, [{
    label: "Daily spend",
    usedPercent: 25,
    resetCadence: "daily",
  }])
  assert.deepEqual(result.notes, [
    "Spend: $15.00 of $60.00",
    "Account credits: $100.00 total · $40.00 used",
  ])
})
