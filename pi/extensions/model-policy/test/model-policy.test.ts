import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import modelPolicyExtension, {
  applyPolicy,
  classifySession,
  isModelAllowed,
  loadPolicy,
  matchRule,
  preferenceWarnings,
  whenPathWarnings,
  type ModelPolicy,
} from "../index.ts"

function model(provider: string, id: string): any {
  return {
    provider,
    id,
    name: id,
    api: "anthropic-messages",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
  }
}

function runtime(initial: Record<string, any[]>, native: Record<string, any> = {}) {
  const catalogs = new Map(Object.entries(initial).map(([id, models]) => [id, [...models]]))
  const nativeProviders = new Map(Object.entries(native))
  const registrations: Array<{ provider: string; count: number; native?: boolean }> = []
  const entries: Array<{ type: string; data: unknown }> = []
  const selected: any[] = []
  const registry = {
    getAll: () => [...catalogs.values()].flat(),
    getAvailable: () => [...catalogs.values()].flat(),
    getProvider: (id: string) => catalogs.has(id) ? { getModels: () => catalogs.get(id)! } : undefined,
    getRegisteredNativeProvider: (id: string) => nativeProviders.get(id),
    getRegisteredProviderConfig: () => undefined,
  }
  const pi = {
    registerProvider(providerOrId: string | any, config?: { models?: any[] }) {
      if (typeof providerOrId === "string") {
        if (config?.models) catalogs.set(providerOrId, [...config.models])
        registrations.push({ provider: providerOrId, count: config?.models?.length ?? -1 })
        return
      }
      catalogs.set(providerOrId.id, [...providerOrId.getModels()])
      nativeProviders.set(providerOrId.id, providerOrId)
      registrations.push({ provider: providerOrId.id, count: providerOrId.getModels().length, native: true })
    },
    async setModel(next: any) {
      selected.push(next)
      return true
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type, data })
    },
  }
  return { catalogs, nativeProviders, registrations, entries, selected, registry, pi }
}

test("loadPolicy is silent for a missing file and rejects malformed input", () => {
  const dir = "/tmp/model-policy-lane/unit-policy"
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const file = `${dir}/policy.json`

  assert.deepEqual(loadPolicy(file), { kind: "missing" })
  writeFileSync(file, "{broken", "utf8")
  const malformedJson = loadPolicy(file)
  assert.equal(malformedJson.kind, "malformed")
  assert.match(malformedJson.kind === "malformed" ? malformedJson.warning : "", /Model policy ignored/)

  writeFileSync(file, JSON.stringify({ rules: [{ when: "/work", enforce: "sometimes" }] }), "utf8")
  assert.equal(loadPolicy(file).kind, "malformed")

  writeFileSync(file, JSON.stringify({ default: { prefer: "anthropic/claude" } }), "utf8")
  assert.equal(loadPolicy(file).kind, "malformed")

  writeFileSync(file, JSON.stringify({ default: { allow: ["*"], prefer: ["anthropic/claude"] }, rules: [] }), "utf8")
  assert.equal(loadPolicy(file).kind, "loaded")
})

test("directory matching uses path segments, not string prefixes", () => {
  const policy: ModelPolicy = {
    default: { allow: ["default/*"] },
    rules: [{ when: "/work/acme", allow: ["acme/*"] }],
  }
  assert.deepEqual(matchRule(policy, "/work/acme/project").rule.allow, ["acme/*"])
  assert.deepEqual(matchRule(policy, "/work/acme-other").rule.allow, ["default/*"])
})

test("matching canonicalizes the operator's typed path casing", () => {
  const policy: ModelPolicy = {
    default: { allow: ["default/*"] },
    rules: [{ when: "~/dev/pubnub", allow: ["work/*"] }],
  }
  assert.deepEqual(
    matchRule(policy, "/Users/jakubszwajka/DEV/pubnub").rule.allow,
    ["work/*"],
  )
  assert.deepEqual(
    matchRule(policy, "/Users/jakubszwajka/DEV/pubnub-old").rule.allow,
    ["default/*"],
  )
})

test("a missing when path uses platform case rules and produces a warning", () => {
  const policy: ModelPolicy = {
    default: { allow: ["default/*"] },
    rules: [{ when: "/tmp/model-policy-lane/DOES-NOT-EXIST", allow: ["missing/*"] }],
  }
  const expected = process.platform === "darwin" || process.platform === "win32"
    ? ["missing/*"]
    : ["default/*"]
  assert.deepEqual(
    matchRule(policy, "/tmp/model-policy-lane/does-not-exist/project").rule.allow,
    expected,
  )
  assert.match(whenPathWarnings(policy)[0], /does not resolve to an existing directory/)
})

test("matching resolves a symlinked cwd to its real path", () => {
  mkdirSync("/tmp/model-policy-lane", { recursive: true })
  const dir = mkdtempSync("/tmp/model-policy-lane/symlink-")
  mkdirSync(`${dir}/real/project`, { recursive: true })
  symlinkSync(`${dir}/real`, `${dir}/linked`)
  const policy: ModelPolicy = {
    default: { allow: ["default/*"] },
    rules: [{ when: `${dir}/real`, allow: ["real/*"] }],
  }
  assert.deepEqual(matchRule(policy, `${dir}/linked/project`).rule.allow, ["real/*"])
})

test("longest literal prefix wins and a later rule wins ties", () => {
  const policy: ModelPolicy = {
    rules: [
      { when: "/work/acme", allow: ["base/*"] },
      { when: "/work/acme/sandbox", allow: ["sandbox/*"] },
      { when: "/work/acme/sandbox", allow: ["later/*"] },
    ],
  }
  const matched = matchRule(policy, "/work/acme/sandbox/demo")
  assert.equal(matched.index, 2)
  assert.deepEqual(matched.rule.allow, ["later/*"])
})

test("directory rules support single and recursive globs", () => {
  const policy: ModelPolicy = {
    rules: [
      { when: "/work/*/sandbox", allow: ["single/*"] },
      { when: "/archive/**/sandbox", allow: ["recursive/*"] },
    ],
  }
  assert.deepEqual(matchRule(policy, "/work/acme/sandbox/subdir").rule.allow, ["single/*"])
  assert.deepEqual(matchRule(policy, "/archive/a/b/sandbox").rule.allow, ["recursive/*"])
  assert.deepEqual(matchRule(policy, "/work/acme/other/sandbox").rule.allow, ["*"])
})

test("model matching applies allow then deny to provider/id and bare id", () => {
  const decision = { allow: ["anthropic/*", "shared-*"], deny: ["*beta*", "anthropic/blocked"] }
  assert.equal(isModelAllowed(model("anthropic", "claude"), decision), true)
  assert.equal(isModelAllowed(model("anthropic", "blocked"), decision), false)
  assert.equal(isModelAllowed(model("openrouter", "shared-stable"), decision), true)
  assert.equal(isModelAllowed(model("openrouter", "shared-beta"), decision), false)
  assert.equal(isModelAllowed(model("amazon-bedrock", "other"), decision), false)
  assert.equal(isModelAllowed(model("anything", "anything"), {}), true)
})

test("session classification covers every mode with and without the child marker", () => {
  for (const mode of ["tui", "print", "rpc", "json"] as const) {
    assert.equal(
      classifySession({ mode }, {}),
      mode === "tui" ? "operator" : "agent",
      `${mode} without child marker`,
    )
    assert.equal(
      classifySession({ mode }, { PI_DELEGATE_ROLE: "child" }),
      "agent",
      `${mode} with child marker`,
    )
  }
})

test("applyPolicy filters providers, supports an empty list, and restores originals", async () => {
  const anthropic = [model("anthropic", "keep"), model("anthropic", "blocked")]
  const bedrock = [model("amazon-bedrock", "one"), model("amazon-bedrock", "two")]
  const harness = runtime({ anthropic, "amazon-bedrock": bedrock })
  const ctx = {
    cwd: "/work/acme",
    mode: "print",
    model: anthropic[0],
    modelRegistry: harness.registry,
    ui: { notify() {} },
  } as any

  const application = await applyPolicy(
    harness.pi as any,
    ctx,
    { rules: [{ when: "/work/acme", allow: ["anthropic/keep"] }] },
    { classification: "agent" },
  )

  assert.equal(application.beforeCount, 4)
  assert.equal(application.afterCount, 1)
  assert.deepEqual(harness.registrations, [
    { provider: "anthropic", count: 1 },
    { provider: "amazon-bedrock", count: 0 },
  ])
  assert.deepEqual(application.survivedProviders, ["anthropic"])

  application.restore()
  assert.equal(application.afterCount, 4)
  assert.deepEqual(harness.catalogs.get("anthropic"), anthropic)
  assert.deepEqual(harness.catalogs.get("amazon-bedrock"), bedrock)
})

test("applyPolicy wraps and restores a native provider without losing its auth object", async () => {
  const nativeModel = model("native-provider", "native-model")
  const auth = { apiKey: { resolve: async () => ({ auth: { apiKey: "test" } }) } }
  const nativeProvider = {
    id: "native-provider",
    name: "Native",
    auth,
    getModels: () => [nativeModel],
    stream() { throw new Error("not called") },
    streamSimple() { throw new Error("not called") },
  }
  const harness = runtime({ "native-provider": [nativeModel] }, { "native-provider": nativeProvider })
  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "print",
      model: nativeModel,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    { default: { allow: [] } },
    { classification: "agent" },
  )

  assert.deepEqual(harness.catalogs.get("native-provider"), [])
  application.restore()
  assert.deepEqual(harness.catalogs.get("native-provider"), [nativeModel])
  assert.equal(harness.nativeProviders.get("native-provider"), nativeProvider)
  assert.equal(harness.nativeProviders.get("native-provider").auth, auth)
})

test("applyPolicy uses an effective-provider wrapper when legacy restore lacks a base URL", async () => {
  const unsafeModel = { ...model("azure-like", "gpt"), baseUrl: "" }
  const effectiveProvider = {
    id: "azure-like",
    name: "Azure-like",
    auth: { apiKey: { resolve: async () => undefined } },
    getModels: () => [unsafeModel],
    stream() { throw new Error("not called") },
    streamSimple() { throw new Error("not called") },
  }
  const harness = runtime({ "azure-like": [unsafeModel] })
  harness.registry.getProvider = () => effectiveProvider

  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "print",
      model: unsafeModel,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    { default: { allow: [] } },
    { classification: "agent" },
  )

  assert.equal(application.nativeProviders.get("azure-like"), effectiveProvider)
  assert.deepEqual(harness.catalogs.get("azure-like"), [])
  application.restore()
  assert.deepEqual(harness.catalogs.get("azure-like"), [unsafeModel])
})

test("pubnub agents-only policy leaves the unmarked operator TUI catalogue untouched", async () => {
  const models = [model("amazon-bedrock", "keep"), model("openai-codex", "other")]
  const harness = runtime({ "amazon-bedrock": [models[0]], "openai-codex": [models[1]] })
  const classification = classifySession({ mode: "tui" }, {})
  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/Users/jakubszwajka/DEV/pubnub",
      mode: "tui",
      model: models[1],
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    {
      rules: [{
        when: "~/dev/pubnub",
        allow: ["amazon-bedrock/*"],
        prefer: ["amazon-bedrock/keep"],
        enforce: "agents",
      }],
    },
    { classification },
  )
  assert.equal(application.classification, "operator")
  assert.equal(application.filtered, false)
  assert.equal(application.beforeCount, application.afterCount)
  assert.deepEqual(harness.registrations, [])
  assert.deepEqual(harness.selected, [])
})

test("applyPolicy switches a disallowed child model and records the switch", async () => {
  const keep = model("anthropic", "keep")
  const blocked = model("openrouter", "blocked")
  const harness = runtime({ anthropic: [keep], openrouter: [blocked] })
  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "tui",
      model: blocked,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    { rules: [{ when: "/work", allow: ["anthropic/*"] }] },
    { classification: "agent" },
  )
  assert.deepEqual(application.switchedModel, {
    from: "openrouter/blocked",
    to: "anthropic/keep",
  })
  assert.equal(harness.selected[0], keep)
  assert.equal(harness.entries[0]?.type, "model-policy:switch")
})

test("applyPolicy honours prefer order before catalogue order", async () => {
  const lite = model("amazon-bedrock", "nova-lite")
  const opus = model("amazon-bedrock", "claude-opus")
  const sonnet = model("amazon-bedrock", "claude-sonnet")
  const blocked = model("openai", "blocked")
  const harness = runtime({ "amazon-bedrock": [lite, opus, sonnet], openai: [blocked] })

  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "print",
      model: blocked,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    {
      default: {
        allow: ["amazon-bedrock/*"],
        prefer: ["amazon-bedrock/claude-opus", "amazon-bedrock/claude-sonnet"],
      },
    },
    { classification: "agent" },
  )

  assert.equal(harness.selected[0], opus)
  assert.equal(application.switchedModel?.to, "amazon-bedrock/claude-opus")
})

test("applyPolicy skips a preferred model rejected by setModel", async () => {
  const first = model("anthropic", "first")
  const second = model("anthropic", "second")
  const blocked = model("openai", "blocked")
  const harness = runtime({ anthropic: [first, second], openai: [blocked] })
  harness.pi.setModel = async (next: any) => {
    harness.selected.push(next)
    return next === second
  }

  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "print",
      model: blocked,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    {
      default: {
        allow: ["anthropic/*"],
        prefer: ["anthropic/first", "anthropic/second"],
      },
    },
    { classification: "agent" },
  )

  assert.deepEqual(harness.selected, [first, second])
  assert.equal(application.switchedModel?.to, "anthropic/second")
})

test("applyPolicy falls back to catalogue order after preferences are exhausted", async () => {
  const catalogueFirst = model("anthropic", "catalogue-first")
  const preferred = model("anthropic", "preferred")
  const blocked = model("openai", "blocked")
  const harness = runtime({ anthropic: [catalogueFirst, preferred], openai: [blocked] })
  harness.pi.setModel = async (next: any) => {
    harness.selected.push(next)
    return next === catalogueFirst
  }

  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "print",
      model: blocked,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    { default: { allow: ["anthropic/*"], prefer: ["anthropic/preferred"] } },
    { classification: "agent" },
  )

  assert.deepEqual(harness.selected, [preferred, catalogueFirst])
  assert.equal(application.switchedModel?.to, "anthropic/catalogue-first")
})

test("a preference contradicted by allow is warned about and ignored", async () => {
  const allowed = model("anthropic", "allowed")
  const contradicted = model("amazon-bedrock", "disallowed")
  const active = model("openai", "blocked")
  const policy: ModelPolicy = {
    default: {
      allow: ["anthropic/*"],
      prefer: ["amazon-bedrock/disallowed"],
    },
  }
  const harness = runtime({
    "amazon-bedrock": [contradicted],
    anthropic: [allowed],
    openai: [active],
  })

  const warnings = preferenceWarnings(policy, harness.registry.getAll())
  const application = await applyPolicy(
    harness.pi as any,
    {
      cwd: "/work",
      mode: "print",
      model: active,
      modelRegistry: harness.registry,
      ui: { notify() {} },
    } as any,
    policy,
    { classification: "agent" },
  )

  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /amazon-bedrock\/disallowed.*disallowed by its rule/)
  assert.deepEqual(harness.selected, [allowed])
  assert.equal(application.switchedModel?.to, "anthropic/allowed")
})

test("extension registers colon commands", () => {
  const commands: string[] = []
  modelPolicyExtension({
    on() {},
    registerCommand(name: string) { commands.push(name) },
  } as unknown as ExtensionAPI)

  assert.deepEqual(commands, ["models:status", "models:unlock", "models:lock"])
})
