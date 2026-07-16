# pi-copilot-discovery

A [pi](https://github.com/earendil-works/pi) extension that replaces pi's
built-in `github-copilot` provider with one that discovers your Copilot
tenant's full model catalog at runtime instead of using pi-ai's bundled
static list.

## Why

pi-ai ships a hand-curated `models.generated.js` listing the GitHub Copilot
models pi knows about. That list lags real Copilot tenants in two ways:

- **Preview / tenant-private models are invisible.** Internal model families,
  early-access SKUs, and anything your enterprise has been allow-listed for
  never show up in `/model`.
- **New public models need a pi-ai release.** When Copilot exposes a new
  model id, pi can't talk to it until pi-ai cuts a release that adds it.

This extension solves both by calling Copilot's own `/models` endpoint on
startup and registering every chat-capable model the signed-in account is
entitled to. Routing to the right pi-ai streamer (`anthropic-messages`,
`openai-responses`, `openai-completions`) is derived from each model's
family.

## What it does

- **Replaces the built-in `github-copilot` provider.** Same provider name, so
  existing credentials, sessions, and `/login github-copilot` workflows keep
  working. `pi --list-models` and `/model` simply show a larger, more
  accurate catalog.
- **Live discovery on start, login, and command.** Fetches `/models` once on
  extension load (async), once after successful `/login github-copilot`, and
  on demand via `/copilot-refresh`.
- **Re-injects Copilot dynamic headers.** pi-ai's built-in streamers add
  `X-Initiator`, `Openai-Intent`, and `Copilot-Vision-Request` only when
  the built-in handler is the one running; this extension installs its own
  `streamSimple` wrapper that re-adds them, preserving agent-vs-user quota
  accounting and vision support.
- **Enables tenant policies post-login.** Runs
  `POST /models/<id>/policy {state:"enabled"}` against *every* discovered
  model after `/login github-copilot`, so preview-tier models accept requests
  on first use. (pi-ai's built-in flow only enables its hardcoded list.)
- **Supports GitHub Enterprise.** The login flow prompts for an enterprise
  domain; `enterpriseUrl` is preserved across pi restarts via
  `OAuthCredentials`'s open-ended index signature.

The personal `github-copilot` credentials, sessions, and behavior stay
intact — this is a drop-in upgrade of the provider, not a parallel one.

## Install

### As a pi package (recommended)

```bash
pi install npm:@zenspc/pi-copilot-discovery
```

Or try it for one session without installing:

```bash
pi -e npm:@zenspc/pi-copilot-discovery
```

### From this monorepo (git or path)

Install only this package from a local checkout:

```bash
git clone https://github.com/zenspc/pi-extensions.git
pi install ./pi-extensions/packages/pi-copilot-discovery
# or one-shot:
pi -e ./pi-extensions/packages/pi-copilot-discovery
```

Or install the whole monorepo and filter to this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/zenspc/pi-extensions",
      "extensions": ["packages/pi-copilot-discovery/src/index.ts"]
    }
  ]
}
```

Restart pi (or run `/reload`) and the live model list takes effect.

### After installing

- If you already have a `github-copilot` entry in `~/.pi/agent/auth.json`, no
  action needed — the existing token is reused.
- Otherwise: `/login github-copilot`. The flow prompts for an enterprise
  host (leave blank for `github.com`).

## Commands

| Command                         | What it does                                              |
| ------------------------------- | --------------------------------------------------------- |
| `/login github-copilot`         | Device-code login + enable policies on all live models    |
| `/copilot-refresh`              | Re-fetch the `/models` catalog without restarting pi      |
| `/copilot-discovery-refresh`    | Alias of `/copilot-refresh` (back-compat)                 |
| `/copilot-context` | Cap tiered models at short-context ceilings (`default`) or use full ~1M windows (`long`); also `status` |
| `/logout github-copilot`        | (Built-in) Clear stored credentials                       |

## How it works

```
pi starts
  └─ extension factory runs
       ├─ register provider override immediately (without `models`)
       │    └─ keeps pi's built-in static github-copilot catalog usable
       └─ async startup discovery
            ├─ read ~/.pi/agent/auth.json["github-copilot"]
            ├─ if credentials present: GET <proxy>/models → ProviderModelConfig[]
            └─ pi.registerProvider("github-copilot", { models, oauth, streamSimple, ... })

/login github-copilot
  └─ pi-ai built-in mints fresh creds; extension enables model policies,
     then triggers one model discovery pass so /model updates immediately

/copilot-refresh
  └─ one manual re-fetch of /models

per request
  └─ pi resolves apiKey via oauth.getApiKey(creds)
       └─ pi auth-storage owns token refresh + persistence
```

### Family → API routing

| Model family pattern            | pi-ai api            | Reasoning |
| ------------------------------- | -------------------- | --------- |
| `claude-*` (3.5+, 4.x, 5.x)     | `anthropic-messages` | yes       |
| `claude-2.x`, `claude-3` (3.0–3.4) | `anthropic-messages` | no    |
| `gpt-5*`, `o1`, `o3`            | `openai-responses`   | yes       |
| `gpt-4*`, `gemini-*`, `grok-*`, other | `openai-completions` | no  |

Heuristics live in `families.ts` and are intentionally conservative — when
uncertain we choose an `api` the model is *usable* under even if not optimal.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/model` shows no Copilot entries before login | No credentials yet. | Run `/login github-copilot`. |
| `/model` empty *after* login on a fresh pi start | Startup discovery failed (network/auth/tenant outage) before the live catalog could load. | Run `/copilot-refresh`; if that also fails, re-run `/login github-copilot`. |
| Some model returns 403 the first time you use it | Tenant policy was `"unconfigured"` and post-login policy enable didn't succeed. | Run `/copilot-refresh` (or re-run `/login github-copilot`). |
| Editor-Version / User-Agent rejected by the work proxy | pi-ai bumped its hardcoded Copilot client strings. | Update `COPILOT_HEADERS` in `models.ts` and `index.ts` to the new values. |
| A new family is misrouted to `openai-completions` | Default fallback. | Open an issue with the model id and tenant `capabilities.family`, or send a PR refining `families.ts`. |

## Session cost estimates

Copilot is billed with usage-based [AI Credits](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
(1 credit = $0.01).
This extension attaches per-model USD rates so pi can estimate session spend in the footer and `/session`.

Rates live in a **static** table (`src/pricing.json`), sourced from GitHub's published models-and-pricing docs.
They are not scraped at runtime.
When GitHub adds a model or changes prices, either:

1. Update `src/pricing.json` (and open a PR / wait for a release), or
2. Drop a local override file (takes effect on next discovery / `/copilot-refresh`):

```json
// ~/.pi/agent/copilot-pricing.json
// (or $PI_CODING_AGENT_DIR/copilot-pricing.json)
{
  "some-new-model": {
    "input": 1.0,
    "output": 5.0,
    "cacheRead": 0.1,
    "cacheWrite": 0
  }
}
```

Units are **USD per 1 million tokens**, matching pi's cost schema.
Long-context models may include `tiers` with `inputTokensAbove` (for example GPT-5.4 above 272K input tokens).
User keys replace bundled keys wholesale per model id.

### Context window and long-context pricing

Some models bill roughly **2x** once total input exceeds a threshold (e.g. GPT-5.4 / 5.5 / 5.6 Sol/Terra at 272K; GPT-5.6 Luna and Gemini 3.1 Pro at 200K).
See [models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).

By default this extension **caps** those models' `contextWindow` at the short-tier ceiling so pi's compaction keeps sessions in the cheaper band (same idea as pi's direct OpenAI catalog).
Non-tiered models still use the full window advertised by `/models`.

Opt into full long context when you need it:

```text
/copilot-context long      # full window (~1M where available)
/copilot-context default   # short-tier cap (cheaper; default)
/copilot-context status    # show current mode
```

Preference is stored in `~/.pi/agent/copilot-context.json` (or `$PI_CODING_AGENT_DIR/...`) and re-applied on every discovery.

You can also raise a single model via pi `models.json` without changing the global mode:

```json
{
  "providers": {
    "github-copilot": {
      "modelOverrides": {
        "gpt-5.4": { "contextWindow": 1000000 }
      }
    }
  }
}
```

Caveats:

- Estimates use list / overage rates.
  They do **not** subtract included monthly AI credits or plan allowances.
- Unknown model ids stay at `$0` so discovery never fails for a missing price.
- Promotional rates (for example temporary Claude Sonnet 5 discounts) can drift from the live docs until the table is updated.
- The short-tier cap guides pi compaction; it does not hard-block the Copilot API if a request still exceeds the threshold.
  If that happens, `cost.tiers` still prices the request at long-context rates.

## Security and privacy

### Credentials

- Reuses pi's existing `github-copilot` OAuth entry under `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`).
- Extension load discovery reads that entry **read-only** to seed the model catalog.
- Token refresh and credential persistence stay owned by pi auth-storage, not by this package writing `auth.json` itself.

### Account mutation

- After `/login github-copilot`, the extension may `POST /models/<id>/policy` with `{ "state": "enabled" }` for discovered models.
- That is intentional so preview-tier models accept requests without manual enablement in the Copilot UI.

### Data leaving the machine

- Discovery and inference traffic go to GitHub Copilot proxy endpoints derived from the live token (individual or enterprise).
- This package does not send analytics to third parties.

### Trust boundary

- Installing this package replaces/overrides the built-in `github-copilot` provider registration path (same provider name).
- Install only from the trusted `@zenspc` npm scope or this GitHub org/repo.

## Compatibility

- pi-coding-agent ≥ 0.78.0 (uses the async extension factory, per-model
  `api` override, OAuth `ProviderConfig`, and the `streamSimple` escape
  hatch).
- pi-ai ≥ 0.78.0 (uses `githubCopilotOAuthProvider`,
  `getGitHubCopilotBaseUrl`, `normalizeDomain`, and the `streamSimple*`
  family).
- Node.js ≥ 22.19.0 (matches pi's `engines` requirement).

## Publishing

This package lives in the [`zenspc/pi-extensions`](https://github.com/zenspc/pi-extensions) monorepo.

See [docs/publishing.md](../../docs/publishing.md) for monorepo publish steps.

## Layout

```
.
├── package.json     pi extension manifest, no runtime npm deps
├── src/
│   ├── index.ts     async factory: registerProvider + /command
│   ├── oauth.ts     delegates login/refresh to pi-ai built-in; enables policies
│   ├── models.ts    fetch /models, build ProviderModelConfig[]
│   ├── pricing.ts   load/merge static + user pricing tables
│   ├── pricing.json static USD/1M rates (+ long-context tiers)
│   ├── context-mode.ts  default|long context preference
│   ├── families.ts  pure: family/id → { api, reasoning, thinkingLevelMap, compat }
│   ├── stream.ts    streamSimple wrapper: inject headers, dispatch
│   └── headers.ts   local re-impl of pi-ai's Copilot dynamic headers
├── AGENTS.md        contributor guide for AI agents
└── README.md
```

## License

MIT. See the monorepo [LICENSE](../../LICENSE).
