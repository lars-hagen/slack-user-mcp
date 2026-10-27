# Option 1 — Shared app + serverless OAuth callback (self-serve)

One Slack app for the whole team. Each engineer clicks an authorize link, approves,
and is shown their own `xoxp` user token in the browser. No per-person apps, no
owner in the loop.

## Why the callback exists at all

Slack has no public-client/PKCE flow: `oauth.v2.access` requires the app's
`client_secret`, so *something* must hold it server-side during the code exchange.
This callback is the smallest possible something — stateless, ~60 lines, no
database. The token is rendered once to the browser and never stored or logged.

## Flow

```
engineer  -> GET /           -> 302 to slack.com/oauth/v2/authorize (user_scope)
Slack     -> consent screen (as the engineer, against the shared app)
engineer  -> GET /callback?code=...
callback  -> oauth.v2.access (client_id + client_secret + code)
          -> reject unless team.id == TEAM_ID
          -> render xoxp once with mcp.json instructions
```

## Files

- `oauth-callback/cloudflare-worker.js` — Cloudflare Workers (fetch handler)
- `oauth-callback/aws-lambda.mjs` — AWS Lambda, Function URL or API Gateway HTTP API (payload v2)

Both are the same logic; porting to any other request/response host is mechanical.

## Where to host it

All of these work; pick on org precedent, not features:

| Host | Notes |
|---|---|
| **AWS Lambda + Function URL** | Zero infra beyond the function; URL is `*.lambda-url.<region>.on.aws`. Put `CLIENT_SECRET` in Secrets Manager or a secure-string env var. CorpIT-friendly since Netskope already runs AWS. |
| **AWS Lambda + API Gateway (HTTP API)** | Same function; needed only if you want a custom domain (`slack-mcp-token.netskope…`) via Route 53 + ACM. |
| **Cloudflare Workers** | Free tier suffices; `wrangler deploy`; secret via `wrangler secret put CLIENT_SECRET`. Custom domain trivial if DNS is on Cloudflare. |
| **GCP Cloud Run** | One container / source deploy; equivalent to Lambda. |
| **Internal EKS/ECS** | Only if a shared internal platform team will own it — overkill otherwise. |

Decision factors: TLS termination (all provide it), a domain CorpIT will approve
for a consent-adjacent page, and who owns the secret. There is no meaningful
performance requirement — the callback serves a request only during onboarding.

## Setup (owner, one time)

1. Create the app at https://api.slack.com/apps from `slack-app-manifest.yaml`
   (or reuse your existing app — the scopes must match `USER_SCOPES`).
2. App config → **OAuth & Permissions → Redirect URLs**: add
   `https://<your-callback-host>/callback`.
3. Deploy the callback with env vars:
   - `CLIENT_ID`, `CLIENT_SECRET` — app → Basic Information
   - `TEAM_ID` — `T029ULNQE` (the callback rejects tokens for any other workspace)
   - `USER_SCOPES` — comma-separated copy of the manifest's user scopes
   - `REDIRECT_URI` — `https://<your-callback-host>/callback`
4. CorpIT ticket: approve the app for the workspace (one approval covers every
   user authorization). Confirm in the ticket whether user-level authorizations
   of an approved app need per-user re-approval (workspace app-management
   setting); normally they do not.
5. Share the callback root URL (`https://<host>/`) with the team.

## Engineer experience (~1 min, self-serve)

1. Open `https://<host>/`, click **Authorize with Slack**, Allow.
2. Copy the `xoxp-…` shown, paste into `~/.omp/agent/mcp.json` as `SLACK_TOKEN`.
3. Restart omp. Done — 18 tools act as their own Slack identity.

## Security notes

- `client_secret` exists only as the host's secret/env var. It never ships to
  engineers. A leaked secret would let an attacker complete an OAuth flow as the
  app (after tricking a user through a consent screen) — treat accordingly.
- Authorization codes expire in ~10 minutes and are single-use; the exchange
  happens server-side immediately.
- Tokens are per-user and independently revocable (app → OAuth & Permissions, or
  `apps.uninstall` per user). Offboarding = revoke one token, not rotate a shared one.
- The page shows the token once and stores nothing; add access logging at the
  host if CorpIT wants an issuance audit trail.
- Optional hardening if required: HMAC-signed `state` param, or restrict the
  callback by corp IP/VPN. Not needed for correctness.
