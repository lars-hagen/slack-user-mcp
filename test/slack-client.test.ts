import assert from "node:assert/strict";
import test from "node:test";
import { SlackClient } from "../index.js";

const originalFetch = globalThis.fetch;

test("omits team_id when no workspace ID is configured", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ok: true, channels: [] }));
  };

  await new SlackClient("xoxp-token").getChannels();

  assert.doesNotMatch(requestedUrl, /team_id=/);
});

test("turns Slack API errors into tool errors", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "missing_scope" }));

  await assert.rejects(
    new SlackClient("xoxp-token").getUsers(),
    /Slack API error: missing_scope/,
  );
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
