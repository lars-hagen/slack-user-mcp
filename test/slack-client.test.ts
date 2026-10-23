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

  await new SlackClient("xoxp-token").getChannels({});

  assert.doesNotMatch(requestedUrl, /team_id=/);
});

test("turns Slack API errors into tool errors", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "missing_scope" }));

  await assert.rejects(
    new SlackClient("xoxp-token").getUsers({}),
    /Slack API error: missing_scope/,
  );
});

test("getChannelHistory passes oldest/latest window and compacts messages", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        ok: true,
        messages: [
          {
            ts: "1792739289.008949",
            user: "U1",
            text: "x".repeat(600),
            thread_ts: "1792739289.008949",
            reply_count: 3,
            reactions: [{ name: "eyes", count: 2 }],
          },
        ],
        has_more: false,
      }),
    );
  };

  const out = (await new SlackClient("xoxp-token").getChannelHistory({
    channel_id: "C1",
    oldest: "1792700000.000000",
    latest: "1792790000.000000",
  })) as { messages: { text: string; thread_ts?: string; reactions?: string[] }[] };

  assert.match(requestedUrl, /oldest=1792700000/);
  assert.match(requestedUrl, /latest=1792790000/);
  assert.equal(out.messages[0].text.length, 512); // 500 + "…[truncated]"
  assert.equal(out.messages[0].thread_ts, undefined); // parent ts not repeated
  assert.deepEqual(out.messages[0].reactions, ["eyes:2"]);
});

test("listDms requests im,mpim types", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ok: true, channels: [] }));
  };

  await new SlackClient("xoxp-token").listDms({});

  assert.match(requestedUrl, /types=im%2Cmpim|types=im,mpim/);
});

test("searchChannels filters by name across pages", async () => {
  const pages = [
    {
      ok: true,
      channels: [
        { id: "C1", name: "engineering" },
        { id: "C2", name: "ai-cc-eng-core" },
      ],
      response_metadata: { next_cursor: "p2" },
    },
    { ok: true, channels: [{ id: "C3", name: "ai-cc-design" }], response_metadata: {} },
  ];
  let call = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("search.messages")) {
      return new Response(JSON.stringify({ ok: true, messages: { total: 0, matches: [] } }));
    }
    return new Response(JSON.stringify(pages[call++]));
  };

  const out = (await new SlackClient("xoxp-token").searchChannels({ query: "ai-cc" })) as {
    channels: { id: string }[];
  };

  assert.deepEqual(out.channels.map((c) => c.id), ["C2", "C3"]);
});

test("searchChannels resolves exact names via search fast path", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("search.messages")) {
      return new Response(
        JSON.stringify({
          ok: true,
          messages: { total: 42, matches: [{ ts: "1.0", channel: { id: "C9", name: "ai-cc-eng-core" } }] },
        }),
      );
    }
    if (url.includes("conversations.info")) {
      return new Response(
        JSON.stringify({ ok: true, channel: { id: "C9", name: "ai-cc-eng-core", is_private: true, num_members: 12 } }),
      );
    }
    return new Response(JSON.stringify({ ok: true, channels: [], response_metadata: {} }));
  };

  const out = (await new SlackClient("xoxp-token").searchChannels({ query: "ai-cc-eng-core" })) as {
    channels: { id: string; num_members?: number }[];
    exhausted: boolean;
  };

  assert.deepEqual(out.channels.map((c) => c.id), ["C9"]);
  assert.equal(out.channels[0].num_members, 12);
  assert.equal(out.exhausted, true);
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
