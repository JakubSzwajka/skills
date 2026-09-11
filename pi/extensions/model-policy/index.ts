import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, normalize, resolve, sep } from "node:path"
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent"
import type { Model, Provider } from "@earendil-works/pi-ai"

export const POLICY_FILE = resolve(homedir(), ".pi/agent/model-policy.json")
const STATUS_KEY = "model-policy"
const SWITCH_ENTRY = "model-policy:switch"

type SessionMode = "tui" | "print" | "rpc" | "json"
export type SessionClass = "operator" | "agent"

export interface PolicyDecision {
  allow?: string[]
  deny?: string[]
  prefer?: string[]
  enforce?: "agents" | "all"
  note?: string
}

export interface PolicyRule extends PolicyDecision {
  when: string
}

export interface ModelPolicy {
  default?: PolicyDecision
  rules?: PolicyRule[]
}

export interface MatchedRule {
  rule: PolicyDecision | PolicyRule
  index: number | null
  literalPrefixLength: number
}

export type LoadPolicyResult =
  | { kind: "loaded"; policy: ModelPolicy }
  | { kind: "missing" }
  | { kind: "malformed"; warning: string }

type PolicyModel = Model<any>
type OriginalModels = Map<string, PolicyModel[]>
type OriginalNativeProviders = Map<string, Provider>

export interface PolicyApplication {
  matched: MatchedRule
  classification: SessionClass
  enforced: boolean
  filtered: boolean
  unlocked: boolean
  beforeCount: number
  afterCount: number
  providersBefore: string[]
  survivedProviders: string[]
  originals: OriginalModels
  nativeProviders: OriginalNativeProviders
  allowedModels: PolicyModel[]
  switchedModel?: { from: string; to: string }
  restore(): void
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validatePatterns(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    return `${field} must be an array of non-empty strings`
  }
  return undefined
}

function validateDecision(value: unknown, field: string): string | undefined {
  if (!isObject(value)) return `${field} must be an object`
  const allowError = validatePatterns(value.allow, `${field}.allow`)
  if (allowError) return allowError
  const denyError = validatePatterns(value.deny, `${field}.deny`)
  if (denyError) return denyError
  const preferError = validatePatterns(value.prefer, `${field}.prefer`)
  if (preferError) return preferError
  if (value.enforce !== undefined && value.enforce !== "agents" && value.enforce !== "all") {
    return `${field}.enforce must be "agents" or "all"`
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    return `${field}.note must be a string`
  }
  return undefined
}

function validatePolicy(value: unknown): value is ModelPolicy {
  if (!isObject(value)) return false
  if (value.default !== undefined && validateDecision(value.default, "default")) return false
  if (value.rules !== undefined && !Array.isArray(value.rules)) return false
  for (const [index, rule] of (value.rules ?? []).entries()) {
    if (!isObject(rule) || typeof rule.when !== "string" || rule.when.length === 0) return false
    if (validateDecision(rule, `rules[${index}]`)) return false
  }
  return true
}

export function loadPolicy(policyFile = POLICY_FILE): LoadPolicyResult {
  if (!existsSync(policyFile)) return { kind: "missing" }

  try {
    const parsed: unknown = JSON.parse(readFileSync(policyFile, "utf8"))
    if (!validatePolicy(parsed)) {
      return {
        kind: "malformed",
        warning: `Model policy ignored: ${policyFile} has an invalid shape.`,
      }
    }
    return { kind: "loaded", policy: parsed }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      kind: "malformed",
      warning: `Model policy ignored: cannot parse ${policyFile}: ${detail}`,
    }
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith(`~${sep}`) || path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2))
  }
  return path
}

function normalizePolicyPath(path: string): string {
  const expanded = expandHome(path)
  return normalize(isAbsolute(expanded) ? expanded : resolve(expanded)).replace(/\/$/, "") || sep
}

function canonicalPolicyPath(path: string): { path: string; exists: boolean } {
  const normalized = normalizePolicyPath(path)
  if (normalized.includes("*")) return { path: normalized, exists: false }
  try {
    return { path: realpathSync.native(normalized), exists: true }
  } catch {
    return { path: normalized, exists: false }
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function pathPatternRegex(pattern: string, ignoreCase = false): RegExp {
  const normalized = normalizePolicyPath(pattern).replaceAll("\\", "/")
  const segments = normalized.split("/").filter(Boolean)
  let source = normalized.startsWith("/") ? "^" : "^"
  for (const segment of segments) {
    if (segment === "**") {
      source += "(?:/[^/]+)*"
      continue
    }
    const segmentSource = escapeRegex(segment).replaceAll("*", "[^/]*")
    source += `/${segmentSource}`
  }
  if (segments.length === 0) source += "/"
  source += "(?:/.*)?$"
  return new RegExp(source, ignoreCase ? "i" : undefined)
}

function literalPrefixLength(pattern: string): number {
  const normalized = normalizePolicyPath(pattern).replaceAll("\\", "/")
  const wildcard = normalized.indexOf("*")
  return (wildcard === -1 ? normalized : normalized.slice(0, wildcard)).replace(/\/$/, "").length
}

function pathMatches(pattern: string, cwd: string): boolean {
  const canonicalPattern = canonicalPolicyPath(pattern)
  const candidate = canonicalPolicyPath(cwd).path.replaceAll("\\", "/")
  const caseInsensitiveFallback = !canonicalPattern.exists
    && (process.platform === "darwin" || process.platform === "win32")
  return pathPatternRegex(canonicalPattern.path, caseInsensitiveFallback).test(candidate)
}

export function matchRule(policy: ModelPolicy, cwd: string): MatchedRule {
  let winner: MatchedRule | undefined
  for (const [index, rule] of (policy.rules ?? []).entries()) {
    if (!pathMatches(rule.when, cwd)) continue
    const prefixLength = literalPrefixLength(rule.when)
    if (!winner || prefixLength >= winner.literalPrefixLength) {
      winner = { rule, index, literalPrefixLength: prefixLength }
    }
  }

  return winner ?? {
    rule: policy.default ?? { allow: ["*"] },
    index: null,
    literalPrefixLength: -1,
  }
}

function globRegex(pattern: string): RegExp {
  return new RegExp(`^${escapeRegex(pattern).replaceAll("*", ".*")}$`)
}

function modelPatternMatches(pattern: string, model: Pick<PolicyModel, "provider" | "id">): boolean {
  const matcher = globRegex(pattern)
  return matcher.test(`${model.provider}/${model.id}`) || matcher.test(model.id)
}

export function isModelAllowed(
  model: Pick<PolicyModel, "provider" | "id">,
  decision: PolicyDecision,
): boolean {
  const allow = decision.allow ?? ["*"]
  const deny = decision.deny ?? []
  return allow.some((pattern) => modelPatternMatches(pattern, model))
    && !deny.some((pattern) => modelPatternMatches(pattern, model))
}

function exactPreferenceModel(pattern: string): Pick<PolicyModel, "provider" | "id"> {
  const separator = pattern.indexOf("/")
  return separator === -1
    ? { provider: "model-policy", id: pattern }
    : { provider: pattern.slice(0, separator), id: pattern.slice(separator + 1) }
}

function decisionPreferenceWarnings(
  decision: PolicyDecision,
  field: string,
  models: Pick<PolicyModel, "provider" | "id">[],
): string[] {
  return (decision.prefer ?? []).flatMap((pattern, index) => {
    const matches = models.filter((model) => modelPatternMatches(pattern, model))
    const contradicted = matches.length > 0
      ? matches.every((model) => !isModelAllowed(model, decision))
      : !pattern.includes("*") && !isModelAllowed(exactPreferenceModel(pattern), decision)
    return contradicted
      ? [`Model policy preference ignored: ${field}.prefer[${index}] ${JSON.stringify(pattern)} is disallowed by its rule.`]
      : []
  })
}

export function preferenceWarnings(
  policy: ModelPolicy,
  models: Pick<PolicyModel, "provider" | "id">[],
): string[] {
  const warnings = policy.default
    ? decisionPreferenceWarnings(policy.default, "default", models)
    : []
  for (const [index, rule] of (policy.rules ?? []).entries()) {
    warnings.push(...decisionPreferenceWarnings(rule, `rules[${index}]`, models))
  }
  return warnings
}

export function whenPathWarnings(policy: ModelPolicy): string[] {
  return (policy.rules ?? []).flatMap((rule, index) => {
    if (rule.when.includes("*")) return []
    const normalized = normalizePolicyPath(rule.when)
    try {
      if (statSync(normalized).isDirectory()) return []
    } catch {}
    return [`Model policy path warning: rules[${index}].when ${JSON.stringify(rule.when)} does not resolve to an existing directory.`]
  })
}

export function classifySession(
  ctx: Pick<ExtensionContext, "mode"> | { mode: SessionMode },
  env: Pick<NodeJS.ProcessEnv, "PI_DELEGATE_ROLE"> = process.env,
): SessionClass {
  return env.PI_DELEGATE_ROLE === "child" || ctx.mode !== "tui" ? "agent" : "operator"
}

function captureOriginals(ctx: Pick<ExtensionContext, "modelRegistry">): {
  originals: OriginalModels
  nativeProviders: OriginalNativeProviders
} {
  const providerIds = [...new Set(ctx.modelRegistry.getAll().map((model) => model.provider))]
  const originals: OriginalModels = new Map()
  const nativeProviders: OriginalNativeProviders = new Map()
  for (const providerId of providerIds) {
    const provider = ctx.modelRegistry.getProvider(providerId)
    const models = provider?.getModels()
    if (models) originals.set(providerId, [...models])
    const native = ctx.modelRegistry.getRegisteredNativeProvider(providerId)
    const legacyConfig = ctx.modelRegistry.getRegisteredProviderConfig(providerId)
    const needsNativeWrapper = !legacyConfig && models?.some((model) => !model.baseUrl)
    if (native) nativeProviders.set(providerId, native)
    else if (provider && needsNativeWrapper) nativeProviders.set(providerId, provider)
  }
  return { originals, nativeProviders }
}

function filteredNativeProvider(provider: Provider, models: PolicyModel[]): Provider {
  return new Proxy(provider, {
    get(target, property) {
      if (property === "getModels") return () => models
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function registerModels(
  pi: Pick<ExtensionAPI, "registerProvider">,
  providerId: string,
  models: PolicyModel[],
  nativeProviders: OriginalNativeProviders,
): void {
  const native = nativeProviders.get(providerId)
  if (native) {
    pi.registerProvider(filteredNativeProvider(native, models))
    return
  }
  pi.registerProvider(providerId, { models: [...models] })
}

function restoreOriginals(
  pi: Pick<ExtensionAPI, "registerProvider">,
  originals: OriginalModels,
  nativeProviders: OriginalNativeProviders,
): void {
  for (const [providerId, models] of originals) {
    const native = nativeProviders.get(providerId)
    if (native) pi.registerProvider(native)
    else pi.registerProvider(providerId, { models: [...models] })
  }
}

async function switchToAllowedModel(
  pi: Pick<ExtensionAPI, "setModel">,
  ctx: Pick<ExtensionContext, "modelRegistry">,
  allowed: PolicyModel[],
  decision: PolicyDecision,
): Promise<PolicyModel | undefined> {
  const availableKeys = new Set(
    ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
  )
  const candidates = allowed.filter((model) => availableKeys.has(`${model.provider}/${model.id}`))
  const attempted = new Set<string>()
  const tryModel = async (model: PolicyModel): Promise<boolean> => {
    attempted.add(`${model.provider}/${model.id}`)
    return pi.setModel(model)
  }

  for (const pattern of decision.prefer ?? []) {
    for (const model of candidates) {
      const key = `${model.provider}/${model.id}`
      if (attempted.has(key) || !modelPatternMatches(pattern, model)) continue
      if (await tryModel(model)) return model
    }
  }
  for (const model of candidates) {
    if (!attempted.has(`${model.provider}/${model.id}`) && await tryModel(model)) return model
  }
  return undefined
}

export async function applyPolicy(
  pi: Pick<ExtensionAPI, "registerProvider" | "setModel" | "appendEntry">,
  ctx: Pick<ExtensionContext, "cwd" | "mode" | "model" | "modelRegistry" | "ui">,
  policy: ModelPolicy,
  options: {
    originals?: OriginalModels
    nativeProviders?: OriginalNativeProviders
    classification?: SessionClass
  } = {},
): Promise<PolicyApplication> {
  const matched = matchRule(policy, ctx.cwd)
  const classification = options.classification ?? classifySession(ctx)
  const enforce = matched.rule.enforce ?? "agents"
  const enforced = enforce === "all" || classification === "agent"
  const captured = options.originals
    ? { originals: options.originals, nativeProviders: options.nativeProviders ?? new Map() }
    : captureOriginals(ctx)
  const { originals, nativeProviders } = captured
  const beforeCount = ctx.modelRegistry.getAvailable().length
  const providersBefore = [...originals.keys()]
  const allowedModels = [...originals.values()].flat().filter((model) => isModelAllowed(model, matched.rule))

  if (enforced) {
    try {
      for (const [providerId, models] of originals) {
        registerModels(
          pi,
          providerId,
          models.filter((model) => isModelAllowed(model, matched.rule)),
          nativeProviders,
        )
      }
    } catch (error) {
      restoreOriginals(pi, originals, nativeProviders)
      throw error
    }
  }

  const application: PolicyApplication = {
    matched,
    classification,
    enforced,
    filtered: enforced,
    unlocked: false,
    beforeCount,
    afterCount: ctx.modelRegistry.getAvailable().length,
    providersBefore,
    survivedProviders: enforced
      ? [...new Set(allowedModels.map((model) => model.provider))]
      : [...providersBefore],
    originals,
    nativeProviders,
    allowedModels,
    restore() {
      restoreOriginals(pi, originals, nativeProviders)
      application.filtered = false
      application.unlocked = true
      application.afterCount = ctx.modelRegistry.getAvailable().length
      application.survivedProviders = [...providersBefore]
    },
  }

  const active = ctx.model
  if (enforced && active && !isModelAllowed(active, matched.rule)) {
    const replacement = await switchToAllowedModel(pi, ctx, allowedModels, matched.rule)
    if (replacement) {
      application.switchedModel = {
        from: `${active.provider}/${active.id}`,
        to: `${replacement.provider}/${replacement.id}`,
      }
      if (classification === "agent") {
        pi.appendEntry(SWITCH_ENTRY, {
          ...application.switchedModel,
          cwd: ctx.cwd,
          reason: "active model was disallowed by the working-directory policy",
        })
      }
    } else {
      ctx.ui.notify("Model policy left no authenticated allowed model to select.", "warning")
    }
  }

  application.afterCount = ctx.modelRegistry.getAvailable().length
  return application
}

function output(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string, level: "info" | "warning" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level)
  else console.log(message)
}

function decisionSummary(decision: PolicyDecision): string {
  const allow = (decision.allow ?? ["*"]).join(",")
  const deny = decision.deny?.length ? ` minus ${decision.deny.join(",")}` : ""
  return `${allow}${deny}`
}

function updateFooter(ctx: Pick<ExtensionContext, "ui">, application?: PolicyApplication): void {
  if (!application) {
    ctx.ui.setStatus(STATUS_KEY, undefined)
    return
  }
  if (application.unlocked) {
    ctx.ui.setStatus(STATUS_KEY, "models: unlocked")
    return
  }
  const enforce = application.matched.rule.enforce ?? "agents"
  ctx.ui.setStatus(STATUS_KEY, `models: ${decisionSummary(application.matched.rule)} (${enforce})`)
}

function formatStatus(ctx: Pick<ExtensionContext, "cwd">, application?: PolicyApplication): string {
  if (!application) return `Model policy\ncwd: ${ctx.cwd}\nmatched rule: none\nfiltering: off`
  const { matched } = application
  const matchedText = matched.index === null
    ? "default"
    : `rule ${matched.index + 1}: ${(matched.rule as PolicyRule).when}`
  return [
    "Model policy",
    `cwd: ${ctx.cwd}`,
    `matched rule: ${matchedText}`,
    `note: ${matched.rule.note || "none"}`,
    `enforce: ${matched.rule.enforce ?? "agents"}`,
    `preference order: ${matched.rule.prefer?.length ? `${matched.rule.prefer.join(" -> ")} -> catalogue order` : "catalogue order"}`,
    `session: ${application.classification}`,
    `filtering: ${application.unlocked ? "unlocked" : application.filtered ? "on" : "off"}`,
    `models: ${application.beforeCount} before, ${application.afterCount} after`,
    `providers: ${application.survivedProviders.join(", ") || "none"}`,
  ].join("\n")
}

export default function modelPolicyExtension(pi: ExtensionAPI): void {
  let policy: ModelPolicy | undefined
  let application: PolicyApplication | undefined
  let switchingModel = false
  let pendingSwitchMessage: string | undefined

  pi.on("session_start", async (_event, ctx) => {
    policy = undefined
    application = undefined
    pendingSwitchMessage = undefined

    const loaded = loadPolicy()
    if (loaded.kind === "missing") {
      updateFooter(ctx)
      return
    }
    if (loaded.kind === "malformed") {
      updateFooter(ctx)
      if (ctx.hasUI) ctx.ui.notify(loaded.warning, "warning")
      else console.warn(loaded.warning)
      return
    }

    policy = loaded.policy
    for (const warning of [
      ...whenPathWarnings(policy),
      ...preferenceWarnings(policy, ctx.modelRegistry.getAll()),
    ]) {
      if (ctx.hasUI) ctx.ui.notify(warning, "warning")
      else console.warn(warning)
    }
    switchingModel = true
    try {
      application = await applyPolicy(pi, ctx, policy, { classification: classifySession(ctx) })
    } finally {
      switchingModel = false
    }
    if (application.switchedModel && application.classification === "agent") {
      pendingSwitchMessage = `Model policy switched this session from ${application.switchedModel.from} to ${application.switchedModel.to}.`
    }
    updateFooter(ctx, application)
  })

  pi.on("before_agent_start", () => {
    if (!pendingSwitchMessage) return
    const content = pendingSwitchMessage
    pendingSwitchMessage = undefined
    return {
      message: {
        customType: "model-policy",
        content,
        display: true,
      },
    }
  })

  pi.on("model_select", async (event, ctx) => {
    if (switchingModel || !application?.filtered || application.unlocked) return
    if (isModelAllowed(event.model, application.matched.rule)) return

    switchingModel = true
    try {
      const replacement = await switchToAllowedModel(
        pi,
        ctx,
        application.allowedModels,
        application.matched.rule,
      )
      if (replacement) {
        ctx.ui.notify(
          `Blocked ${event.model.provider}/${event.model.id}; restored ${replacement.provider}/${replacement.id}.`,
          "warning",
        )
      } else {
        ctx.ui.notify("Blocked model selection, but no authenticated allowed model is available.", "warning")
      }
    } finally {
      switchingModel = false
    }
  })

  pi.registerCommand("models:status", {
    description: "Show the working-directory model policy for this session",
    handler: async (_args, ctx) => output(ctx, formatStatus(ctx, application)),
  })

  pi.registerCommand("models:unlock", {
    description: "Restore the full captured model catalogue in this TUI session",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        output(ctx, "Model policy unlock is available only in an operator TUI session.", "warning")
        return
      }
      if (!application || !policy) {
        output(ctx, "No model policy is active in this session.")
        return
      }
      if (application.classification !== "operator") {
        output(ctx, "Model policy unlock is available only in an operator TUI session.", "warning")
        return
      }
      if (!application.filtered) {
        output(ctx, "This policy does not filter the operator TUI session.")
        return
      }
      if (!await ctx.ui.confirm("Unlock model policy?", "Restore the full model catalogue for this session only?")) return
      application.restore()
      updateFooter(ctx, application)
      output(ctx, `Model policy unlocked. Restored ${application.afterCount} models for this session.`)
    },
  })

  pi.registerCommand("models:lock", {
    description: "Re-apply the working-directory model policy",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!policy || !application) {
        output(ctx, "No model policy is active in this session.")
        return
      }
      switchingModel = true
      try {
        application = await applyPolicy(pi, ctx, policy, {
          originals: application.originals,
          nativeProviders: application.nativeProviders,
          classification: classifySession(ctx),
        })
      } finally {
        switchingModel = false
      }
      if (application.switchedModel && application.classification === "agent") {
        pendingSwitchMessage = `Model policy switched this session from ${application.switchedModel.from} to ${application.switchedModel.to}.`
      }
      updateFooter(ctx, application)
      output(ctx, application.filtered ? "Model policy applied." : "Policy leaves this operator TUI session unfiltered.")
    },
  })
}
