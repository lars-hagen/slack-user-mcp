# Proposal — Self-serve Slack onboarding for omp agents (slack-user-mcp)

**Status:** proposal · **Date:** 2026-10-26 · **Author:** Shripad Kulkarni
**Audience:** AICC eng, CorpIT (app approval) · **Thread:** [ai-tools](https://netskope.slack.com/archives/C0AGE6KFM71/p1792380603747079)

## Problem

The omp + slack-user-mcp setup (MCP server on a personal Slack user token) works
and is documented in the ai-tools thread. Adoption blocker: onboarding today
means **every engineer creates their own Slack app and files their own CorpIT
ticket**. Expected user base is 20–50 engineers, so the current shape is 20–50
tickets and 20–50 hand-built app configs — and Aswin has already asked whether
the app can simply be shared.

## Constraint that shapes everything

Slack has **no public-client/PKCE OAuth flow**. Every user token (`xoxp`) is
minted by `oauth.v2.access`, which requires the app's `client_secret`. The
secret must live somewhere the token recipient does not control. Consequences:

- "Click Allow and the browser shows your token" is impossible without a
  server-side exchange step holding the secret.
- Sharing one person's `xoxp` across the team is not an option: every action
  posts as that person, and one revocation kills everyone.

Any self-serve design is therefore exactly one of two shapes: a shared app plus
a secret-holding exchange endpoint (Option 1), or per-user apps where each user
owns their own secret (Option 2).

## Option 1 — Shared app + serverless OAuth callback

One Slack app for the team, one CorpIT approval. A ~60-line stateless serverless
function performs the code→token exchange and renders the user's `xoxp` once in
their browser. Nothing is stored; the secret lives only as the function's env
var.

**Engineer experience (~1 min, fully self-serve):** open the callback URL →
Authorize with Slack → Allow → copy token → paste into
`~/.omp/agent/mcp.json` → restart omp.

**Implementation (written, smoke-tested):**
- `oauth-callback/cloudflare-worker.js` — Cloudflare Workers
- `oauth-callback/aws-lambda.mjs` — AWS Lambda (Function URL or API Gateway)
- Walkthrough: `docs/option-1-shared-app-callback.md`

**Hosting options** (all equivalent; choose on org precedent): AWS Lambda +
Function URL (recommended — existing Netskope AWS footprint, easiest CorpIT
story), Lambda + API Gateway if a custom domain is wanted, Cloudflare Workers,
GCP Cloud Run. The callback serves one request per onboarding; there are no
performance or availability requirements to speak of.

**Security properties:**
- `client_secret` exists only in the function's config — never shipped to users.
- Authorization codes are single-use, ~10-min TTL, exchanged server-side.
- Callback rejects tokens issued for any workspace other than `T029ULNQE`.
- Per-user tokens: individual revocation, clean offboarding, per-identity audit.
- Optional hardening if CorpIT asks: HMAC `state` param, corp-IP restriction,
  issuance access logs.

## Option 2 — Per-user apps from a shared manifest

The current flow, productized: `slack-app-manifest.yaml` (in the repo) pre-fills
the app name and the full 20-scope user-token set. Engineer: Create New App →
From a manifest → paste → Install to Workspace → copy token. ~3 min, no hosting,
no shared secrets anywhere.

Walkthrough + trade-off table: `docs/option-2-manifest-self-service.md`.

**Only self-serve if** CorpIT blanket-approves apps created from this exact
manifest — otherwise it's N tickets again.

## Comparison

| | Option 1 (shared app + callback) | Option 2 (manifest per user) |
|---|---|---|
| Engineer effort | ~1 min | ~3 min |
| CorpIT | 1 app approval | 1 blanket-manifest approval (must be granted) |
| Hosting | 1 serverless function | none |
| Shared secrets | `client_secret` in function env | none |
| Scope changes later | owner edits app once; users re-authorize | every user edits + reinstalls their app |
| Revocation / offboarding | revoke one user token | delete the user's app |
| Failure modes | callback down → onboarding pauses (existing users unaffected) | none beyond Slack itself |

## Recommendation

**Option 1**, with Option 2 as the fallback if CorpIT objects to a shared app or
to the callback. Rationale: single approval, least per-user friction, scope
changes propagate centrally, and the callback is deploy-once-forget.

## CorpIT ticket must ask (either option)

1. Approve the app (Option 1) or the manifest as a template (Option 2) for the
   Netskope workspace.
2. Confirm whether the workspace's app-management setting requires **per-user
   re-approval of authorizations** for an approved app — this decides whether
   Option 1 is truly one ticket.
3. (Option 1) Approve the callback's domain/TLS endpoint per the hosting choice.

## Addendum — "why not a localhost callback like Claude's official Slack MCP?" (thread Q&A, 2026-10-26)

Asked by Aswin in the thread: Claude's official Slack MCP plugin spins up a
`localhost:3118` listener for the OAuth redirect — could we do that instead of
hosting anything?

**Why localhost works there and not for a shared classic app:**
`mcp.slack.com` is an MCP-native authorization server — Dynamic Client
Registration (RFC 7591) + PKCE (RFC 7636) + loopback redirect (RFC 8252). Each
MCP client registers itself and proves the exchange with a per-flow PKCE
verifier; there is no shared app secret to protect. Classic Slack apps (the
source of `xoxp` user tokens) support neither DCR nor PKCE — the exchange still
requires the app's `client_secret`, so a localhost listener on a *shared* app
would mean shipping the secret to every laptop. Anyone holding it can run a
consent-phishing flow as the app. Not acceptable.

**Where the localhost trick does apply: Option 2.** With per-user manifest apps
each engineer owns their own app's client_id/secret (visible on their own app
page), so a localhost-callback onboarding script is safe: create app from
`slack-app-manifest.yaml` → run `npm run onboard` → script opens the authorize
URL, listens on `localhost:<port>`, catches the code, exchanges it with the
user's own credentials, writes the token straight into `~/.omp/agent/mcp.json`.
No hosting, no shared secret, no token copy-paste — near-parity with the
official plugin's UX. Build it if Option 2 becomes the chosen path.

(Why not just use Slack's hosted MCP: the thread's original problem — NSClient
TLS-intercepts `mcp.slack.com` and breaks its OAuth — plus slack-user-mcp
exposes 18 user-token tools the hosted MCP doesn't, incl. workspace search and
DMs.)

## Rollout

1. File the CorpIT ticket (above asks).
2. Deploy the callback (Option 1) — ~30 min.
3. Post the self-serve link in the ai-tools thread; update the README to point
   at the chosen option.
4. Keep the existing per-app instructions as the documented fallback.
