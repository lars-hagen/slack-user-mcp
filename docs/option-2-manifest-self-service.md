# Option 2 — Per-user apps from a shared manifest (no hosting, no shared secrets)

Each engineer creates their own Slack app from a pre-filled manifest and copies
their own user token. Fully self-serve on the Slack side; nothing is hosted and
no secret is ever shared, because every app has its own client secret, visible
only to its creator.

The catch: at Netskope each new app install needs CorpIT approval, so this is
self-serve only if CorpIT agrees to blanket-approve apps created from this exact
manifest. Ask for that explicitly in the ticket — it turns N approvals into one
standing approval.

## Steps (per engineer, ~3 min)

1. https://api.slack.com/apps → **Create New App** → **From a manifest**.
2. Pick the Netskope workspace, paste the contents of
   [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) (YAML tab), Create.
3. (If prompted by workspace app management: submit for approval — covered by
   the CorpIT blanket approval.)
4. **Install to Workspace** → Allow.
5. Copy the **User OAuth Token** (`xoxp-…`) from OAuth & Permissions.
6. Put it in `~/.omp/agent/mcp.json`:

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/absolute/path/to/slack-user-mcp/dist/index.js"],
      "env": {
        "SLACK_TOKEN": "xoxp-your-token-here",
        "SLACK_TEAM_ID": "T029ULNQE"
      }
    }
  }
}
```

7. Restart omp (MCP servers mount at process start).

## What the manifest encodes

The full scope set from the setup guide — core (`channels:history`,
`channels:read`, `chat:write`, `reactions:write`, `users:read`) plus extended
(`search:read`, DM/private-channel read+write, `users:read.email`,
`reactions:read`, `files:write`, `emoji:read`, …) so nobody has to re-issue a
token later when a tool needs a scope that was skipped.

## Trade-offs vs. Option 1 (shared app + callback)

| | Option 2 (manifest) | Option 1 (shared app) |
|---|---|---|
| Hosting | none | one serverless callback |
| Shared secrets | none — per-app secrets | `client_secret` in the callback host |
| CorpIT | blanket approval of the manifest (ask) | one app approval |
| Scope changes | each user edits + reinstalls their own app | owner edits once; users re-authorize |
| Revocation/offboarding | delete the user's app | revoke the user's token |
| Engineer effort | ~3 min, fully self-serve | ~1 min, fully self-serve |
