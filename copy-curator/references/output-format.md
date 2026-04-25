# Review Output Format

Use this exact structure for review output unless the user asks for a different format.

## 1. Short summary

Start with 2-5 bullets:
- which files were reviewed
- how suggestions were grouped into pages/features
- how many copy suggestions were found
- whether hardcoded UI strings were detected

## 2. Suggestions grouped by page or feature

Group suggestions by the most useful user-facing surface.

Prefer this grouping order:
1. route or page file context
2. feature directory or component boundary
3. i18n namespace/key prefix
4. `Shared/Common` if no stronger grouping is available

Use this block format for every suggestion:

```md
## <Page or feature>

### <i18n key>
- Tags: awkward, literal translation
- Reason: Short explanation of why the current copy should change

**Current EN**: ...
**Proposed EN**: ...

**Current PL**: ...
**Proposed PL**: ...
```

Rules:
- Show only keys that actually need change
- Keep reasons short and specific
- Show both languages even if only one side is noticeably bad
- If one side should stay unchanged, repeat it and say why in the reason

## 3. Terminology notes

If wording touches established product or domain terms, add a separate section:

```md
## Terminology notes
- `<term>` appears inconsistent across keys X/Y/Z. I did not change it automatically.
```

## 4. Hardcoded UI strings

If hardcoded user-visible strings exist outside i18n JSON files, report them separately:

```md
## Hardcoded UI strings
- `packages/web/src/.../component.tsx:42` — "..."
  - Why flag it: user-visible copy should live in i18n
  - Suggested action: move to localization layer
```

Do not auto-edit source files unless the user explicitly asks.

## 5. Approval prompt

Always end with an approval prompt such as:

```md
Reply with one of:
- `apply all`
- `apply only <page/key list>`
- `regenerate <page/key> with a different tone`
- `skip terminology-related suggestions`
```

## Apply step rules

When the user approves:
- apply only approved suggestions
- edit the JSON files directly
- preserve formatting and key names
- summarize what was changed by file
- keep hardcoded-string findings as recommendations unless the user also asked to fix them