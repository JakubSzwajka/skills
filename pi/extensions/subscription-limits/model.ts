export type LimitWindow = {
  label: string
  usedPercent: number
  resetAt?: number
  resetCadence?: string
}

export type ProviderLimits = {
  id: "openai-codex" | "anthropic" | "openrouter"
  title: string
  subtitle?: string
  windows: LimitWindow[]
  notes: string[]
  error?: string
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function titleWords(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function clampPercent(value: unknown): number | undefined {
  const parsed = number(value)
  if (parsed === undefined) return undefined
  return Math.max(0, Math.min(100, parsed))
}

function resetEpochSeconds(window: JsonObject): number | undefined {
  const resetAt = number(window.reset_at)
  if (resetAt !== undefined) return resetAt * 1000

  const resetAfter = number(window.reset_after_seconds)
  if (resetAfter !== undefined) return Date.now() + resetAfter * 1000
  return undefined
}

export function durationLabel(seconds: unknown): string {
  const duration = number(seconds)
  if (duration === undefined) return "Limit"
  if (duration >= 6 * 24 * 60 * 60 && duration <= 8 * 24 * 60 * 60) return "Weekly"
  if (duration >= 4 * 60 * 60 && duration <= 6 * 60 * 60) return "5-hour"
  if (duration >= 24 * 60 * 60) return `${Math.round(duration / 86_400)}-day`
  if (duration >= 60 * 60) return `${Math.round(duration / 3_600)}-hour`
  return `${Math.round(duration / 60)}-minute`
}

function codexWindow(window: unknown, prefix?: string): LimitWindow | undefined {
  const value = object(window)
  if (!value) return undefined
  const usedPercent = clampPercent(value.used_percent)
  if (usedPercent === undefined) return undefined
  const duration = value.limit_window_seconds ?? value.window_minutes
  const durationSeconds = value.limit_window_seconds ?? (
    number(value.window_minutes) === undefined ? undefined : number(value.window_minutes)! * 60
  )
  const label = durationLabel(durationSeconds ?? duration)
  return {
    label: prefix ? `${prefix} · ${label}` : label,
    usedPercent,
    resetAt: resetEpochSeconds(value),
  }
}

function appendCodexRateLimit(
  windows: LimitWindow[],
  rateLimit: unknown,
  prefix?: string,
): void {
  const value = object(rateLimit)
  if (!value) return
  const primary = codexWindow(value.primary_window, prefix)
  const secondary = codexWindow(value.secondary_window, prefix)
  if (primary) windows.push(primary)
  if (secondary) windows.push(secondary)
}

export function parseCodexLimits(payload: unknown): ProviderLimits {
  const root = object(payload) ?? {}
  const windows: LimitWindow[] = []
  appendCodexRateLimit(windows, root.rate_limit)
  appendCodexRateLimit(windows, root.code_review_rate_limit, "Code review")

  if (Array.isArray(root.additional_rate_limits)) {
    for (const raw of root.additional_rate_limits) {
      const item = object(raw)
      if (!item) continue
      const name = string(item.limit_name) ?? string(item.metered_feature) ?? "Additional"
      appendCodexRateLimit(windows, item.rate_limit, name)
    }
  }

  const notes: string[] = []
  const credits = object(root.credits)
  if (credits) {
    const balance = number(credits.balance)
    if (credits.unlimited === true) notes.push("Credits: unlimited")
    else if (credits.has_credits === true && balance !== undefined) notes.push(`Credits: $${balance.toFixed(2)}`)
  }

  const resetCredits = object(root.rate_limit_reset_credits)
  const resetCount = resetCredits ? number(resetCredits.applicable_available_count) : undefined
  if (resetCount && resetCount > 0) notes.push(`Reset credits available: ${resetCount}`)

  return {
    id: "openai-codex",
    title: "ChatGPT Codex",
    subtitle: string(root.plan_type) ? titleWords(string(root.plan_type)!) : undefined,
    windows,
    notes,
  }
}

function parseIsoReset(value: unknown): number | undefined {
  const raw = string(value)
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function claudeLimitLabel(limit: JsonObject): string {
  const kind = string(limit.kind) ?? "limit"
  if (kind === "session") return "5-hour session"
  if (kind === "weekly_all") return "Weekly all models"
  if (kind === "weekly_scoped") {
    const scope = object(limit.scope)
    const model = object(scope?.model)
    const displayName = string(model?.display_name)
    if (displayName) return `Weekly ${displayName}`
    return "Weekly scoped"
  }
  return titleWords(kind)
}

function legacyClaudeWindows(root: JsonObject): LimitWindow[] {
  const labels: Record<string, string> = {
    five_hour: "5-hour session",
    seven_day: "Weekly all models",
    seven_day_opus: "Weekly Opus",
    seven_day_sonnet: "Weekly Sonnet",
    seven_day_oauth_apps: "Weekly OAuth apps",
    seven_day_cowork: "Weekly Cowork",
  }
  const windows: LimitWindow[] = []
  for (const [key, label] of Object.entries(labels)) {
    const value = object(root[key])
    if (!value) continue
    const usedPercent = clampPercent(value.utilization)
    if (usedPercent === undefined) continue
    windows.push({ label, usedPercent, resetAt: parseIsoReset(value.resets_at) })
  }
  return windows
}

export function parseClaudeLimits(payload: unknown): ProviderLimits {
  const root = object(payload) ?? {}
  const windows: LimitWindow[] = []

  if (Array.isArray(root.limits)) {
    for (const raw of root.limits) {
      const limit = object(raw)
      if (!limit) continue
      const usedPercent = clampPercent(limit.percent)
      if (usedPercent === undefined) continue
      windows.push({
        label: claudeLimitLabel(limit),
        usedPercent,
        resetAt: parseIsoReset(limit.resets_at),
      })
    }
  }
  if (windows.length === 0) windows.push(...legacyClaudeWindows(root))

  const notes: string[] = []
  const extraUsage = object(root.extra_usage)
  if (extraUsage) {
    if (extraUsage.is_enabled === true) {
      const utilization = clampPercent(extraUsage.utilization)
      notes.push(utilization === undefined ? "Extra usage: enabled" : `Extra usage: ${utilization.toFixed(0)}% used`)
    } else {
      notes.push("Extra usage: off")
    }
  }

  return {
    id: "anthropic",
    title: "Claude",
    windows,
    notes,
  }
}

export function parseOpenRouterLimits(keyPayload: unknown, creditsPayload: unknown): ProviderLimits {
  const keyRoot = object(keyPayload)
  const key = object(keyRoot?.data) ?? keyRoot ?? {}
  const creditsRoot = object(creditsPayload)
  const credits = object(creditsRoot?.data) ?? creditsRoot ?? {}
  const windows: LimitWindow[] = []
  const notes: string[] = []

  const limit = number(key.limit)
  const usage = number(key.usage)
  if (limit !== undefined && limit > 0 && usage !== undefined) {
    windows.push({
      label: `${titleWords(string(key.limit_reset) ?? "spend")} spend`,
      usedPercent: Math.max(0, Math.min(100, usage / limit * 100)),
      resetCadence: string(key.limit_reset),
    })
    notes.push(`Spend: $${usage.toFixed(2)} of $${limit.toFixed(2)}`)
  }

  const totalCredits = number(credits.total_credits)
  const totalUsage = number(credits.total_usage)
  if (totalCredits !== undefined && totalUsage !== undefined) {
    notes.push(`Account credits: $${totalCredits.toFixed(2)} total · $${totalUsage.toFixed(2)} used`)
  }

  return {
    id: "openrouter",
    title: "OpenRouter",
    subtitle: "Credits, not a subscription",
    windows,
    notes,
  }
}
