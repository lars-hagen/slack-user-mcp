// Slack shared-app OAuth callback — AWS Lambda variant (Function URL or API Gateway
// HTTP API, payload v2). Same flow as cloudflare-worker.js.
//
// Env vars (Lambda configuration; CLIENT_SECRET from Secrets Manager or a
// secure-string env var, never in the template/repo):
//   CLIENT_ID, CLIENT_SECRET, TEAM_ID, USER_SCOPES, REDIRECT_URI

const PAGES = {
  home: (authUrl) => `<!doctype html><title>Slack MCP token</title>
    <h2>Get your Slack token for slack-user-mcp</h2>
    <p>You will be sent to Slack to approve read/write access <b>as yourself</b>.
    After approving, come back here and your personal <code>xoxp-</code> token is shown once.</p>
    <p><a href="${authUrl}"><b>Authorize with Slack</b></a></p>`,
  token: (tok) => `<!doctype html><title>Your token</title>
    <h2>Your Slack user token (shown once — copy it now)</h2>
    <pre style="padding:1em;background:#f4f4f4">${tok}</pre>
    <p>Add it to <code>~/.omp/agent/mcp.json</code> under <code>mcpServers.slack.env.SLACK_TOKEN</code>,
    then restart omp. Treat it like a password: never commit it, never post it in a channel.</p>`,
  error: (msg) => `<!doctype html><title>Error</title><h2>Authorization failed</h2><pre>${msg}</pre>`,
};

const html = (body, statusCode = 200) => ({
  statusCode,
  headers: { "content-type": "text/html" },
  body,
});

function authorizeUrl(env) {
  const q = new URLSearchParams({
    client_id: env.CLIENT_ID,
    user_scope: env.USER_SCOPES,
    redirect_uri: env.REDIRECT_URI,
  });
  return `https://slack.com/oauth/v2/authorize?${q}`;
}

export const handler = async (event) => {
  const env = process.env;
  const path = event.rawPath || "/";
  const params = event.queryStringParameters || {};

  if (path === "/") return html(PAGES.home(authorizeUrl(env)));

  if (path === "/callback") {
    if (params.error) return html(PAGES.error(params.error));
    if (!params.code) return html(PAGES.error("missing code"));

    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        code: params.code,
        redirect_uri: env.REDIRECT_URI,
      }),
    });
    const data = await res.json();

    if (!data.ok) return html(PAGES.error(data.error || "exchange failed"));
    if (data.team?.id !== env.TEAM_ID) {
      return html(PAGES.error("wrong workspace: " + (data.team?.id || "unknown")));
    }
    const token = data.authed_user?.access_token;
    if (!token) return html(PAGES.error("no user token in response (user_scope missing?)"));
    return html(PAGES.token(token));
  }

  return html("not found", 404);
};
