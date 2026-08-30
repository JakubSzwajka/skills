import {
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent"
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui"
import {
  parseClaudeLimits,
  parseCodexLimits,
  parseOpenRouterLimits,
  type LimitWindow,
  type ProviderLimits,
} from "./model.ts"

type Theme = ExtensionCommandContext["ui"]["theme"]
type RequestAuth = NonNullable<Awaited<ReturnType<ExtensionCommandContext["modelRegistry"]["getProviderAuth"]>>>

const REQUEST_TIMEOUT_MS = 12_000

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const payload = token.split(".")[1]
    if (!payload) return undefined
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function codexAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token)
  const auth = payload?.["https://api.openai.com/auth"]
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return undefined
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id
  return typeof accountId === "string" && accountId ? accountId : undefined
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function requestHeaders(auth: RequestAuth, extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: "application/json",
    ...(auth.auth.headers ?? {}),
    ...extra,
  }
}

async function loadCodex(ctx: ExtensionCommandContext, signal: AbortSignal): Promise<ProviderLimits> {
  const auth = await ctx.modelRegistry.getProviderAuth("openai-codex")
  const token = auth?.auth.apiKey
  if (!auth || !token) throw new Error("not logged in")

  const accountId = codexAccountId(token)
  const payload = await fetchJson(
    "https://chatgpt.com/backend-api/wham/usage",
    requestHeaders(auth, {
      authorization: `Bearer ${token}`,
      ...(accountId ? { "chatgpt-account-id": accountId } : {}),
    }),
    signal,
  )
  return parseCodexLimits(payload)
}

async function loadClaude(ctx: ExtensionCommandContext, signal: AbortSignal): Promise<ProviderLimits> {
  const auth = await ctx.modelRegistry.getProviderAuth("anthropic")
  const token = auth?.auth.apiKey
  if (!auth || !token) throw new Error("not logged in")

  const baseUrl = (auth.auth.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")
  const payload = await fetchJson(
    `${baseUrl}/api/oauth/usage`,
    requestHeaders(auth, {
      authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    }),
    signal,
  )
  return parseClaudeLimits(payload)
}

async function loadOpenRouter(ctx: ExtensionCommandContext, signal: AbortSignal): Promise<ProviderLimits> {
  const auth = await ctx.modelRegistry.getProviderAuth("openrouter")
  const token = auth?.auth.apiKey
  if (!auth || !token) throw new Error("not logged in")

  const headers = requestHeaders(auth, { authorization: `Bearer ${token}` })
  const [key, credits] = await Promise.all([
    fetchJson("https://openrouter.ai/api/v1/key", headers, signal),
    fetchJson("https://openrouter.ai/api/v1/credits", headers, signal),
  ])
  return parseOpenRouterLimits(key, credits)
}

function providerError(
  id: ProviderLimits["id"],
  title: string,
  error: unknown,
): ProviderLimits {
  const message = error instanceof Error ? error.message : String(error)
  const friendly = /HTTP 401|HTTP 403|not logged in/i.test(message)
    ? "Login expired or missing. Run /login for this provider."
    : message
  return { id, title, windows: [], notes: [], error: friendly }
}

async function loadAllLimits(
  ctx: ExtensionCommandContext,
  signal: AbortSignal,
): Promise<ProviderLimits[]> {
  const loaders = [
    { id: "openai-codex" as const, title: "ChatGPT Codex", load: loadCodex },
    { id: "anthropic" as const, title: "Claude", load: loadClaude },
    { id: "openrouter" as const, title: "OpenRouter", load: loadOpenRouter },
  ]

  const configured = loaders.filter(({ id }) => ctx.modelRegistry.getProviderAuthStatus(id).configured)
  return Promise.all(configured.map(async ({ id, title, load }) => {
    try {
      return await load(ctx, signal)
    } catch (error) {
      if (signal.aborted) throw error
      return providerError(id, title, error)
    }
  }))
}

function percentText(percent: number): string {
  if (percent > 0 && percent < 1) return "<1%"
  return `${Math.round(percent)}%`
}

function bar(window: LimitWindow, width: number, theme: Theme): string {
  const cells = Math.max(6, Math.min(20, width))
  const filled = Math.round(window.usedPercent / 100 * cells)
  const color = window.usedPercent >= 90 ? "error" : window.usedPercent >= 75 ? "warning" : "accent"
  return theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(cells - filled))
}

function resetText(window: LimitWindow, now = Date.now()): string {
  if (window.resetAt !== undefined) {
    const diff = Math.max(0, window.resetAt - now)
    const totalMinutes = Math.ceil(diff / 60_000)
    const days = Math.floor(totalMinutes / 1_440)
    const hours = Math.floor(totalMinutes % 1_440 / 60)
    const minutes = totalMinutes % 60
    const relative = days > 0
      ? `${days}d ${hours}h`
      : hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m`
    const local = new Date(window.resetAt).toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    return `resets in ${relative} · ${local}`
  }
  if (window.resetCadence) return `resets ${window.resetCadence} · exact time not returned`
  return "reset time not returned"
}

function plainText(providers: ProviderLimits[]): string {
  const lines = ["Subscription limits"]
  for (const provider of providers) {
    lines.push(`\n${provider.title}${provider.subtitle ? ` · ${provider.subtitle}` : ""}`)
    if (provider.error) {
      lines.push(`  ${provider.error}`)
      continue
    }
    for (const window of provider.windows) {
      lines.push(`  ${window.label}: ${percentText(window.usedPercent)} used, ${resetText(window)}`)
    }
    for (const note of provider.notes) lines.push(`  ${note}`)
  }
  return lines.join("\n")
}

class LimitsDashboard implements Component {
  constructor(
    private readonly providers: ProviderLimits[],
    private readonly theme: Theme,
    private readonly close: () => void,
  ) {}

  handleInput(data: string): void {
    if (data === "q" || matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) this.close()
  }

  render(width: number): string[] {
    const usable = Math.max(20, width - 2)
    const barWidth = usable >= 70 ? 20 : usable >= 48 ? 12 : 8
    const lines: string[] = [
      this.theme.fg("accent", this.theme.bold("Subscription limits")),
      this.theme.fg("dim", "Provider-reported usage. Refreshes each time you open /limits."),
      "",
    ]

    for (const [index, provider] of this.providers.entries()) {
      const heading = provider.subtitle
        ? `${provider.title} · ${provider.subtitle}`
        : provider.title
      lines.push(this.theme.bold(heading))

      if (provider.error) {
        lines.push(`  ${this.theme.fg("warning", provider.error)}`)
      } else if (provider.windows.length === 0) {
        lines.push(`  ${this.theme.fg("muted", "No quota windows returned")}`)
      } else {
        for (const window of provider.windows) {
          const percent = percentText(window.usedPercent).padStart(4)
          if (usable >= 62) {
            const labelWidth = Math.min(28, Math.max(18, usable - barWidth - 28))
            const label = window.label.length > labelWidth
              ? `${window.label.slice(0, Math.max(1, labelWidth - 1))}…`
              : window.label.padEnd(labelWidth)
            lines.push(`  ${label} ${bar(window, barWidth, this.theme)} ${this.theme.bold(percent)}`)
            lines.push(`  ${"".padEnd(labelWidth)} ${this.theme.fg("dim", resetText(window))}`)
          } else {
            lines.push(`  ${window.label}  ${this.theme.bold(percent)}`)
            lines.push(`  ${bar(window, barWidth, this.theme)}  ${this.theme.fg("dim", resetText(window))}`)
          }
        }
      }

      for (const note of provider.notes) lines.push(`  ${this.theme.fg("muted", note)}`)
      if (index < this.providers.length - 1) lines.push("")
    }

    lines.push("", this.theme.fg("dim", "Enter/q/esc close"))
    return lines.map((line) => truncateToWidth(line, width, ""))
  }

  invalidate(): void {}
}

async function showLimits(ctx: ExtensionCommandContext): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), REQUEST_TIMEOUT_MS)

  let providers: ProviderLimits[] | null = null
  try {
    if (ctx.mode === "tui") {
      providers = await ctx.ui.custom<ProviderLimits[] | null>((tui, theme, _keybindings, done) => {
        const loader = new BorderedLoader(tui, theme, "Checking subscription limits…")
        let closed = false
        const finish = (value: ProviderLimits[] | null) => {
          if (closed) return
          closed = true
          done(value)
        }
        loader.onAbort = () => {
          controller.abort(new Error("Cancelled"))
          finish(null)
        }
        void loadAllLimits(ctx, controller.signal)
          .then(finish)
          .catch(() => finish(null))
        return loader
      })
    } else {
      providers = await loadAllLimits(ctx, controller.signal)
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!providers) return
  if (providers.length === 0) {
    ctx.ui.notify("No Codex, Claude, or OpenRouter credentials are configured.", "warning")
    return
  }

  if (ctx.mode !== "tui") {
    const text = plainText(providers)
    if (ctx.hasUI) ctx.ui.notify(text, "info")
    else console.log(text)
    return
  }

  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) =>
    new LimitsDashboard(providers, theme, done),
  )
}

export default function subscriptionLimits(pi: ExtensionAPI): void {
  pi.registerCommand("limits", {
    description: "Show subscription usage, quota windows, and reset times",
    handler: async (_args, ctx) => showLimits(ctx),
  })
}
