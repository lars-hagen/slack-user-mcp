#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Slack API domain types (fields we consume; Slack objects carry more)
// ---------------------------------------------------------------------------

interface SlackChannel {
  id: string;
  name?: string;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_archived?: boolean;
  user?: string;
  num_members?: number;
  purpose?: { value?: string };
  topic?: { value?: string };
  updated?: number;
}

interface SlackReaction {
  name: string;
  count: number;
  users?: string[];
}

interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: SlackReaction[];
  files?: SlackFile[];
  permalink?: string;
  channel?: string | { id: string; name?: string; is_im?: boolean };
}

interface SlackUserProfile {
  real_name?: string;
  display_name?: string;
  email?: string;
  title?: string;
  status_text?: string;
  status_emoji?: string;
  phone?: string;
  tz?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  deleted?: boolean;
  tz?: string;
  profile?: SlackUserProfile;
}

interface SlackPaged {
  response_metadata?: { next_cursor?: string };
}

// ---------------------------------------------------------------------------
// Tool arguments
// ---------------------------------------------------------------------------

interface VerboseArg {
  verbose?: boolean;
}

interface ListChannelsArgs extends VerboseArg {
  limit?: number;
  cursor?: string;
  /** Comma-separated: public_channel,private_channel,im,mpim */
  types?: string;
  name_filter?: string;
  include_archived?: boolean;
}

interface SearchChannelsArgs extends VerboseArg {
  query: string;
  limit?: number;
}

interface ListDmsArgs extends VerboseArg {
  limit?: number;
  cursor?: string;
}

interface ScheduleMessageArgs {
  channel_id: string;
  text: string;
  /** Unix epoch seconds */
  post_at: number;
}

interface GetReactionsArgs extends VerboseArg {
  channel_id: string;
  timestamp: string;
}

interface GetChannelHistoryArgs extends VerboseArg {
  channel_id: string;
  limit?: number;
  /** Only messages after this Slack ts (inclusive), e.g. local midnight epoch */
  oldest?: string;
  latest?: string;
  cursor?: string;
}

interface GetThreadRepliesArgs extends VerboseArg {
  channel_id: string;
  thread_ts: string;
  limit?: number;
  oldest?: string;
  latest?: string;
}

interface SearchMessagesArgs extends VerboseArg {
  query: string;
  count?: number;
  page?: number;
  sort?: "score" | "timestamp";
  sort_dir?: "asc" | "desc";
}

interface GetUsersArgs extends VerboseArg {
  cursor?: string;
  limit?: number;
  name_filter?: string;
}

interface ListChannelMembersArgs {
  channel_id: string;
  limit?: number;
  cursor?: string;
}

interface CreateConversationArgs {
  /** Channel name (without #). Omit when opening a DM. */
  name?: string;
  is_private?: boolean;
  /** Comma-separated user IDs to open a DM / group DM with. */
  user_ids?: string;
}

interface UploadFileArgs {
  file_path: string;
  channel_id?: string;
  title?: string;
  initial_comment?: string;
}

// ---------------------------------------------------------------------------
// Compact formatters (token efficiency). verbose=true returns raw Slack JSON.
// ---------------------------------------------------------------------------

const MAX_TEXT = 500;

/** Compact projection of a channel object; fields map 1:1 to SlackChannel. */
function formatChannel(c: SlackChannel, verbose?: boolean): Record<string, unknown> {
  if (verbose) return c as unknown as Record<string, unknown>;
  const cut = (v: string | undefined, max = 150) =>
    v === undefined ? undefined : v.length > max ? v.slice(0, max) + "…[truncated]" : v;
  return {
    id: c.id,
    name: c.name,
    is_private: c.is_private,
    is_im: c.is_im,
    is_mpim: c.is_mpim,
    is_archived: c.is_archived,
    user: c.user,
    num_members: c.num_members,
    purpose: cut(c.purpose?.value),
    topic: cut(c.topic?.value),
    updated: c.updated,
  };
}

/** Compact projection of a message; truncates text, flattens reactions/files. */
function formatMessage(m: SlackMessage, verbose?: boolean): Record<string, unknown> {
  if (verbose) return m as unknown as Record<string, unknown>;
  const text = m.text;
  return {
    ts: m.ts,
    user: m.user,
    username: m.username,
    bot_id: m.bot_id,
    text: text === undefined ? undefined : text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…[truncated]" : text,
    thread_ts: m.thread_ts !== m.ts ? m.thread_ts : undefined,
    reply_count: m.reply_count,
    reactions: m.reactions?.map((r) => `${r.name}:${r.count}`),
    files: m.files?.map((f) => ({ id: f.id, name: f.name, mimetype: f.mimetype })),
    permalink: m.permalink,
    channel: typeof m.channel === "object"
      ? { id: m.channel.id, name: m.channel.name, is_im: m.channel.is_im }
      : m.channel,
  };
}

/** Compact projection of a user. */
function formatUser(u: SlackUser, verbose?: boolean): Record<string, unknown> {
  if (verbose) return u as unknown as Record<string, unknown>;
  return {
    id: u.id,
    name: u.name,
    real_name: u.real_name,
    display_name: u.profile?.display_name,
    email: u.profile?.email,
    title: u.profile?.title,
    is_bot: u.is_bot,
    deleted: u.deleted,
    tz: u.tz,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const listChannelsTool: Tool = {
  name: "slack_list_channels",
  description:
    "List conversations in the workspace. Returns compact channel objects (id, name, is_private, num_members, ...). Use types to include private channels or DMs, name_filter to search by name substring.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max channels to return (default 20, max 200)", default: 20 },
      cursor: { type: "string", description: "Pagination cursor for next page" },
      types: {
        type: "string",
        description: "Comma-separated conversation types: public_channel, private_channel, im, mpim (default public_channel). private_channel requires groups:read; im/mpim require im:read/mpim:read.",
      },
      name_filter: { type: "string", description: "Only return channels whose name contains this substring (case-insensitive)" },
      include_archived: { type: "boolean", description: "Include archived channels (default false)" },
      verbose: { type: "boolean", description: "Return full raw Slack objects (default false)" },
    },
  },
};

const searchChannelsTool: Tool = {
  name: "slack_search_channels",
  description:
    "Find channels by name across public and private channels. More efficient than paging slack_list_channels when you need one channel's ID.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name substring to search for (case-insensitive)" },
      limit: { type: "number", description: "Max matches (default 10)", default: 10 },
      verbose: { type: "boolean" },
    },
    required: ["query"],
  },
};

const listDmsTool: Tool = {
  name: "slack_list_dms",
  description:
    "List your direct message and group DM conversations, most recently updated first. Requires im:read / mpim:read user scopes.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max conversations (default 20, max 200)", default: 20 },
      cursor: { type: "string" },
      verbose: { type: "boolean" },
    },
  },
};

const searchMessagesTool: Tool = {
  name: "slack_search_messages",
  description:
    "Search messages workspace-wide using Slack search modifiers: in:#channel, from:@user, after:YYYY-MM-DD, before:YYYY-MM-DD, has:link etc. Requires search:read (user token).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Slack search query, e.g. 'deploy in:#ai-cc-eng-core after:2026-10-22'" },
      count: { type: "number", description: "Results per page (default 20, max 100)", default: 20 },
      page: { type: "number", description: "Page number (default 1)" },
      sort: { type: "string", enum: ["score", "timestamp"], description: "Sort field (default timestamp)" },
      sort_dir: { type: "string", enum: ["asc", "desc"], description: "Sort direction (default desc)" },
      verbose: { type: "boolean" },
    },
    required: ["query"],
  },
};

const postMessageTool: Tool = {
  name: "slack_post_message",
  description: "Post a new message to any conversation (channel or DM)",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string", description: "The ID of the channel/conversation to post to" },
      text: { type: "string", description: "The message text to post" },
    },
    required: ["channel_id", "text"],
  },
};

const scheduleMessageTool: Tool = {
  name: "slack_schedule_message",
  description: "Schedule a message to be sent to a conversation at a future time",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string" },
      text: { type: "string" },
      post_at: { type: "number", description: "Unix epoch seconds when the message should be sent" },
    },
    required: ["channel_id", "text", "post_at"],
  },
};

const replyToThreadTool: Tool = {
  name: "slack_reply_to_thread",
  description: "Reply to a specific message thread in Slack",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string", description: "The ID of the channel containing the thread" },
      thread_ts: {
        type: "string",
        description: "Timestamp of the parent message, format '1234567890.123456'",
      },
      text: { type: "string", description: "The reply text" },
    },
    required: ["channel_id", "thread_ts", "text"],
  },
};

const addReactionTool: Tool = {
  name: "slack_add_reaction",
  description: "Add a reaction emoji to a message. Requires reactions:write.",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string" },
      timestamp: { type: "string", description: "The ts of the message to react to" },
      reaction: { type: "string", description: "Emoji name without colons" },
    },
    required: ["channel_id", "timestamp", "reaction"],
  },
};

const getReactionsTool: Tool = {
  name: "slack_get_reactions",
  description: "Get the emoji reactions on a message. Requires reactions:read.",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string" },
      timestamp: { type: "string", description: "The ts of the message" },
      verbose: { type: "boolean" },
    },
    required: ["channel_id", "timestamp"],
  },
};

const getChannelHistoryTool: Tool = {
  name: "slack_get_channel_history",
  description:
    "Get messages from a channel or DM. Use oldest/latest (Slack ts) to bound a time window, e.g. 'today' = oldest of local midnight.",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string", description: "The ID of the channel/conversation" },
      limit: { type: "number", description: "Number of messages (default 20)", default: 20 },
      oldest: { type: "string", description: "Only messages after this ts (inclusive)" },
      latest: { type: "string", description: "Only messages before this ts" },
      cursor: { type: "string" },
      verbose: { type: "boolean" },
    },
    required: ["channel_id"],
  },
};

const getThreadRepliesTool: Tool = {
  name: "slack_get_thread_replies",
  description: "Get replies in a message thread",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string" },
      thread_ts: {
        type: "string",
        description: "Timestamp of the parent message, format '1234567890.123456'",
      },
      limit: { type: "number", description: "Max replies (default 50)", default: 50 },
      oldest: { type: "string" },
      latest: { type: "string" },
      verbose: { type: "boolean" },
    },
    required: ["channel_id", "thread_ts"],
  },
};

const getUsersTool: Tool = {
  name: "slack_get_users",
  description: "List users in the workspace (compact profiles). Use name_filter to find someone.",
  inputSchema: {
    type: "object",
    properties: {
      cursor: { type: "string" },
      limit: { type: "number", description: "Max users (default 50, max 200)", default: 50 },
      name_filter: { type: "string", description: "Filter by name/real_name/display_name substring (case-insensitive)" },
      verbose: { type: "boolean" },
    },
  },
};

const getUserProfileTool: Tool = {
  name: "slack_get_user_profile",
  description: "Get detailed profile information for a specific user",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "The ID of the user" },
      verbose: { type: "boolean" },
    },
    required: ["user_id"],
  },
};

const lookupUserByEmailTool: Tool = {
  name: "slack_lookup_user_by_email",
  description: "Find a user by email address. Requires users:read.email.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string" },
      verbose: { type: "boolean" },
    },
    required: ["email"],
  },
};

const listChannelMembersTool: Tool = {
  name: "slack_list_channel_members",
  description: "List user IDs of members of a channel/conversation",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: { type: "string" },
      limit: { type: "number", description: "Max members (default 100)", default: 100 },
      cursor: { type: "string" },
    },
    required: ["channel_id"],
  },
};

const createConversationTool: Tool = {
  name: "slack_create_conversation",
  description:
    "Create a channel (pass name) or open a DM/group DM (pass user_ids). Requires channels:write / groups:write / im:write / mpim:write as applicable.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Channel name without #. Omit to open a DM." },
      is_private: { type: "boolean", description: "Create as private channel (default false)" },
      user_ids: { type: "string", description: "Comma-separated user IDs to open a DM or group DM with" },
    },
  },
};

const uploadFileTool: Tool = {
  name: "slack_upload_file",
  description:
    "Upload a local file to Slack (two-step external upload), optionally sharing to a channel. Requires files:write.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute path to the local file" },
      channel_id: { type: "string", description: "Channel/conversation to share the file to" },
      title: { type: "string" },
      initial_comment: { type: "string" },
    },
    required: ["file_path"],
  },
};

const getEmojiListTool: Tool = {
  name: "slack_get_emoji_list",
  description: "List custom emoji in the workspace. Compact mode returns names only.",
  inputSchema: {
    type: "object",
    properties: {
      verbose: { type: "boolean", description: "Include emoji URLs/aliases (default false)" },
    },
  },
};

// ---------------------------------------------------------------------------
// Slack client
// ---------------------------------------------------------------------------

export class SlackClient {
  private headers: { Authorization: string; "Content-Type": string };
  private teamId?: string;

  constructor(token: string, teamId?: string) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    this.teamId = teamId;
  }

  /**
   * Slack Web API call. The caller declares the response shape via T; the
   * envelope check (ok/error) is validated here, the payload is trusted to
   * match the documented method shape.
   */
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, headers: this.headers });
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new Error(`Slack API returned an invalid response (${response.status})`);
    }

    const envelope = body as { ok?: boolean; error?: string };

    if (!response.ok) {
      throw new Error(`Slack API request failed (${response.status}): ${envelope.error || response.statusText}`);
    }

    if (!envelope.ok) {
      throw new Error(`Slack API error: ${envelope.error || "unknown error"}`);
    }

    return body as T;
  }

  private conversationsListParams(limit: number, cursor?: string, types?: string, includeArchived?: boolean): URLSearchParams {
    const params = new URLSearchParams({
      types: types || "public_channel",
      limit: Math.min(limit, 200).toString(),
    });
    if (!includeArchived) params.set("exclude_archived", "true");
    if (this.teamId) params.set("team_id", this.teamId);
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async getChannels(args: ListChannelsArgs): Promise<Record<string, unknown>> {
    const params = this.conversationsListParams(args.limit ?? 20, args.cursor, args.types, args.include_archived);
    const body = await this.request<{ channels?: SlackChannel[] } & SlackPaged>(
      `https://slack.com/api/conversations.list?${params}`,
    );
    let channels = body.channels ?? [];
    if (args.name_filter) {
      const needle = args.name_filter.toLowerCase();
      channels = channels.filter((c) => c.name?.toLowerCase().includes(needle));
    }
    return {
      channels: channels.map((c) => formatChannel(c, args.verbose)),
      next_cursor: body.response_metadata?.next_cursor || undefined,
    };
  }

  async searchChannels(args: SearchChannelsArgs): Promise<Record<string, unknown>> {
    const needle = args.query.toLowerCase();
    const max = args.limit ?? 10;
    const matches = new Map<string, Record<string, unknown>>();

    // Phase 1: exact-name fast path via search (avoids scanning thousands of
    // channels on large workspaces). `in:` matches exact channel names only.
    try {
      const probe = await this.request<{
        messages?: { total?: number; matches?: SlackMessage[] };
      }>(`https://slack.com/api/search.messages?${new URLSearchParams({ query: `in:${args.query}`, count: "1" })}`);
      const hit = probe.messages?.matches?.[0]?.channel;
      if ((probe.messages?.total ?? 0) > 0 && hit && typeof hit === "object" && hit.name?.toLowerCase() === needle) {
        const info = await this.request<{ channel: SlackChannel }>(
          `https://slack.com/api/conversations.info?channel=${hit.id}`,
        );
        matches.set(info.channel.id, formatChannel(info.channel, args.verbose));
      }
    } catch {
      // search:read or channel not found by exact name — continue to scan
    }

    // Phase 2: paged scan for partial matches (cap 10 pages; large workspaces
    // can exceed this — caller gets partial:true so they can retry narrower)
    let cursor: string | undefined;
    let exhausted = false;
    for (let page = 0; page < 10 && matches.size < max; page++) {
      const params = this.conversationsListParams(200, cursor, "public_channel,private_channel");
      const body = await this.request<{ channels?: SlackChannel[] } & SlackPaged>(
        `https://slack.com/api/conversations.list?${params}`,
      );
      for (const c of body.channels ?? []) {
        if (c.name?.toLowerCase().includes(needle) && !matches.has(c.id)) {
          matches.set(c.id, formatChannel(c, args.verbose));
        }
        if (matches.size >= max) break;
      }
      cursor = body.response_metadata?.next_cursor || undefined;
      if (!cursor) { exhausted = true; break; }
    }
    return { channels: [...matches.values()].slice(0, max), exhausted };
  }

  async listDms(args: ListDmsArgs): Promise<Record<string, unknown>> {
    const params = this.conversationsListParams(args.limit ?? 20, args.cursor, "im,mpim");
    const body = await this.request<{ channels?: SlackChannel[] } & SlackPaged>(
      `https://slack.com/api/conversations.list?${params}`,
    );
    const dms = (body.channels ?? [])
      .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
      .map((c) => formatChannel(c, args.verbose));
    return { conversations: dms, next_cursor: body.response_metadata?.next_cursor || undefined };
  }

  async searchMessages(args: SearchMessagesArgs): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      query: args.query,
      count: Math.min(args.count ?? 20, 100).toString(),
      page: (args.page ?? 1).toString(),
      sort: args.sort ?? "timestamp",
      sort_dir: args.sort_dir ?? "desc",
    });
    const body = await this.request<{
      messages?: { total?: number; paging?: { pages?: number }; matches?: SlackMessage[] };
    }>(`https://slack.com/api/search.messages?${params}`);
    return {
      total: body.messages?.total ?? 0,
      pages: body.messages?.paging?.pages ?? 0,
      matches: (body.messages?.matches ?? []).map((m) => formatMessage(m, args.verbose)),
    };
  }

  async postMessage(channel_id: string, text: string): Promise<Record<string, unknown>> {
    const body = await this.request<{ ts: string; channel: string }>(
      "https://slack.com/api/chat.postMessage",
      { method: "POST", body: JSON.stringify({ channel: channel_id, text }) },
    );
    return { ts: body.ts, channel: body.channel };
  }

  async scheduleMessage(args: ScheduleMessageArgs): Promise<Record<string, unknown>> {
    const body = await this.request<{ scheduled_message_id: string; channel: string; post_at: number }>(
      "https://slack.com/api/chat.scheduleMessage",
      {
        method: "POST",
        body: JSON.stringify({ channel: args.channel_id, text: args.text, post_at: args.post_at }),
      },
    );
    return { scheduled_message_id: body.scheduled_message_id, channel: body.channel, post_at: body.post_at };
  }

  async postReply(channel_id: string, thread_ts: string, text: string): Promise<Record<string, unknown>> {
    const body = await this.request<{ ts: string; channel: string }>(
      "https://slack.com/api/chat.postMessage",
      { method: "POST", body: JSON.stringify({ channel: channel_id, thread_ts, text }) },
    );
    return { ts: body.ts, channel: body.channel };
  }

  async addReaction(channel_id: string, timestamp: string, reaction: string): Promise<Record<string, unknown>> {
    await this.request<Record<string, never>>("https://slack.com/api/reactions.add", {
      method: "POST",
      body: JSON.stringify({ channel: channel_id, timestamp, name: reaction }),
    });
    return { added: reaction };
  }

  async getReactions(args: GetReactionsArgs): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ channel: args.channel_id, timestamp: args.timestamp, full: "true" });
    const body = await this.request<{ message?: SlackMessage }>(
      `https://slack.com/api/reactions.get?${params}`,
    );
    if (args.verbose) return body as Record<string, unknown>;
    return {
      ts: body.message?.ts,
      reactions: (body.message?.reactions ?? []).map((r) => ({ name: r.name, count: r.count, users: r.users })),
    };
  }

  async getChannelHistory(args: GetChannelHistoryArgs): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      channel: args.channel_id,
      limit: (args.limit ?? 20).toString(),
    });
    if (args.oldest) params.set("oldest", args.oldest);
    if (args.latest) params.set("latest", args.latest);
    if (args.cursor) params.set("cursor", args.cursor);
    const body = await this.request<{ messages?: SlackMessage[]; has_more?: boolean } & SlackPaged>(
      `https://slack.com/api/conversations.history?${params}`,
    );
    return {
      messages: (body.messages ?? []).map((m) => formatMessage(m, args.verbose)),
      has_more: body.has_more,
      next_cursor: body.response_metadata?.next_cursor || undefined,
    };
  }

  async getThreadReplies(args: GetThreadRepliesArgs): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      channel: args.channel_id,
      ts: args.thread_ts,
      limit: (args.limit ?? 50).toString(),
    });
    if (args.oldest) params.set("oldest", args.oldest);
    if (args.latest) params.set("latest", args.latest);
    const body = await this.request<{ messages?: SlackMessage[]; has_more?: boolean }>(
      `https://slack.com/api/conversations.replies?${params}`,
    );
    return {
      messages: (body.messages ?? []).map((m) => formatMessage(m, args.verbose)),
      has_more: body.has_more,
    };
  }

  async getUsers(args: GetUsersArgs): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ limit: Math.min(args.limit ?? 50, 200).toString() });
    if (this.teamId) params.set("team_id", this.teamId);
    if (args.cursor) params.set("cursor", args.cursor);
    const body = await this.request<{ members?: SlackUser[] } & SlackPaged>(
      `https://slack.com/api/users.list?${params}`,
    );
    let users = body.members ?? [];
    if (args.name_filter) {
      const needle = args.name_filter.toLowerCase();
      users = users.filter((u) =>
        [u.name, u.real_name, u.profile?.display_name].some(
          (n) => typeof n === "string" && n.toLowerCase().includes(needle),
        ),
      );
    }
    return {
      users: users.map((u) => formatUser(u, args.verbose)),
      next_cursor: body.response_metadata?.next_cursor || undefined,
    };
  }

  async getUserProfile(user_id: string, verbose?: boolean): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ user: user_id, include_labels: "true" });
    const body = await this.request<{ profile?: SlackUserProfile }>(
      `https://slack.com/api/users.profile.get?${params}`,
    );
    if (verbose) return body as Record<string, unknown>;
    const p = body.profile ?? {};
    return {
      user_id,
      real_name: p.real_name,
      display_name: p.display_name,
      email: p.email,
      title: p.title,
      status_text: p.status_text,
      status_emoji: p.status_emoji,
      phone: p.phone,
      tz: p.tz,
    };
  }

  async lookupUserByEmail(email: string, verbose?: boolean): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ email });
    const body = await this.request<{ user: SlackUser }>(
      `https://slack.com/api/users.lookupByEmail?${params}`,
    );
    return { user: formatUser(body.user, verbose) };
  }

  async listChannelMembers(args: ListChannelMembersArgs): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      channel: args.channel_id,
      limit: Math.min(args.limit ?? 100, 1000).toString(),
    });
    if (args.cursor) params.set("cursor", args.cursor);
    const body = await this.request<{ members?: string[] } & SlackPaged>(
      `https://slack.com/api/conversations.members?${params}`,
    );
    return {
      members: body.members ?? [],
      next_cursor: body.response_metadata?.next_cursor || undefined,
    };
  }

  async createConversation(args: CreateConversationArgs): Promise<Record<string, unknown>> {
    if (args.user_ids) {
      const body = await this.request<{ channel: SlackChannel; already_open?: boolean }>(
        "https://slack.com/api/conversations.open",
        { method: "POST", body: JSON.stringify({ users: args.user_ids }) },
      );
      return { channel: formatChannel(body.channel, false), already_open: body.already_open };
    }
    if (!args.name) throw new Error("Provide either name (channel) or user_ids (DM)");
    const body = await this.request<{ channel: SlackChannel }>(
      "https://slack.com/api/conversations.create",
      { method: "POST", body: JSON.stringify({ name: args.name, is_private: args.is_private ?? false }) },
    );
    return { channel: formatChannel(body.channel, false) };
  }

  async uploadFile(args: UploadFileArgs): Promise<Record<string, unknown>> {
    const data = await readFile(args.file_path);
    const info = await stat(args.file_path);
    const filename = basename(args.file_path);

    // Step 1: get an upload URL
    const urlParams = new URLSearchParams({ filename, length: info.size.toString() });
    if (args.title) urlParams.set("title", args.title);
    const step1 = await this.request<{ upload_url: string; file_id: string }>(
      `https://slack.com/api/files.getUploadURLExternal?${urlParams}`,
    );

    // Step 2: POST the bytes to the upload URL (raw bytes, not JSON)
    const uploadResp = await fetch(step1.upload_url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data),
    });
    if (!uploadResp.ok) {
      throw new Error(`File upload failed (${uploadResp.status}): ${await uploadResp.text()}`);
    }

    // Step 3: complete the upload, optionally sharing to a channel
    const completePayload: Record<string, unknown> = {
      files: [{ id: step1.file_id, title: args.title ?? filename }],
    };
    if (args.channel_id) completePayload.channel_id = args.channel_id;
    if (args.initial_comment) completePayload.initial_comment = args.initial_comment;
    const step3 = await this.request<{ files?: SlackFile[] }>(
      "https://slack.com/api/files.completeUploadExternal",
      { method: "POST", body: JSON.stringify(completePayload) },
    );
    return {
      file_id: step1.file_id,
      title: args.title ?? filename,
      shared_to: args.channel_id,
      files: step3.files?.map((f) => ({ id: f.id, name: f.name })),
    };
  }

  async getEmojiList(verbose?: boolean): Promise<Record<string, unknown>> {
    const body = await this.request<{ emoji?: Record<string, string> }>(
      "https://slack.com/api/emoji.list",
    );
    const emoji = body.emoji ?? {};
    if (verbose) return { count: Object.keys(emoji).length, emoji };
    return { count: Object.keys(emoji).length, names: Object.keys(emoji) };
  }
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

async function main() {
  const token = process.env.SLACK_TOKEN || process.env.SLACK_BOT_TOKEN;
  const teamId = process.env.SLACK_TEAM_ID;

  if (!token) {
    console.error("Please set the SLACK_TOKEN (or SLACK_BOT_TOKEN) environment variable");
    process.exit(1);
  }

  console.error("Starting Slack MCP Server...");
  const server = new Server(
    { name: "Slack MCP Server", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  const slackClient = new SlackClient(token, teamId);

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      console.error("Received CallToolRequest:", request.params.name);
      try {
        if (!request.params.arguments) {
          throw new Error("No arguments provided");
        }
        const respond = (payload: Record<string, unknown>) => ({
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        });
        // request.params.arguments is schema-validated per tool by MCP clients;
        // cast per case to the matching args interface.
        const a = request.params.arguments as Record<string, unknown>;

        switch (request.params.name) {
          case "slack_list_channels":
            return respond(await slackClient.getChannels(a as unknown as ListChannelsArgs));

          case "slack_search_channels": {
            if (!a.query) throw new Error("Missing required argument: query");
            return respond(await slackClient.searchChannels(a as unknown as SearchChannelsArgs));
          }

          case "slack_list_dms":
            return respond(await slackClient.listDms(a as unknown as ListDmsArgs));

          case "slack_search_messages": {
            if (!a.query) throw new Error("Missing required argument: query");
            return respond(await slackClient.searchMessages(a as unknown as SearchMessagesArgs));
          }

          case "slack_post_message": {
            if (!a.channel_id || !a.text) throw new Error("Missing required arguments: channel_id and text");
            return respond(await slackClient.postMessage(a.channel_id as string, a.text as string));
          }

          case "slack_schedule_message": {
            if (!a.channel_id || !a.text || !a.post_at) throw new Error("Missing required arguments: channel_id, text, post_at");
            return respond(await slackClient.scheduleMessage(a as unknown as ScheduleMessageArgs));
          }

          case "slack_reply_to_thread": {
            if (!a.channel_id || !a.thread_ts || !a.text) throw new Error("Missing required arguments: channel_id, thread_ts, and text");
            return respond(await slackClient.postReply(a.channel_id as string, a.thread_ts as string, a.text as string));
          }

          case "slack_add_reaction": {
            if (!a.channel_id || !a.timestamp || !a.reaction) throw new Error("Missing required arguments: channel_id, timestamp, and reaction");
            return respond(await slackClient.addReaction(a.channel_id as string, a.timestamp as string, a.reaction as string));
          }

          case "slack_get_reactions": {
            if (!a.channel_id || !a.timestamp) throw new Error("Missing required arguments: channel_id and timestamp");
            return respond(await slackClient.getReactions(a as unknown as GetReactionsArgs));
          }

          case "slack_get_channel_history": {
            if (!a.channel_id) throw new Error("Missing required argument: channel_id");
            return respond(await slackClient.getChannelHistory(a as unknown as GetChannelHistoryArgs));
          }

          case "slack_get_thread_replies": {
            if (!a.channel_id || !a.thread_ts) throw new Error("Missing required arguments: channel_id and thread_ts");
            return respond(await slackClient.getThreadReplies(a as unknown as GetThreadRepliesArgs));
          }

          case "slack_get_users":
            return respond(await slackClient.getUsers(a as unknown as GetUsersArgs));

          case "slack_get_user_profile": {
            if (!a.user_id) throw new Error("Missing required argument: user_id");
            return respond(await slackClient.getUserProfile(a.user_id as string, a.verbose as boolean | undefined));
          }

          case "slack_lookup_user_by_email": {
            if (!a.email) throw new Error("Missing required argument: email");
            return respond(await slackClient.lookupUserByEmail(a.email as string, a.verbose as boolean | undefined));
          }

          case "slack_list_channel_members": {
            if (!a.channel_id) throw new Error("Missing required argument: channel_id");
            return respond(await slackClient.listChannelMembers(a as unknown as ListChannelMembersArgs));
          }

          case "slack_create_conversation":
            return respond(await slackClient.createConversation(a as unknown as CreateConversationArgs));

          case "slack_upload_file": {
            if (!a.file_path) throw new Error("Missing required argument: file_path");
            return respond(await slackClient.uploadFile(a as unknown as UploadFileArgs));
          }

          case "slack_get_emoji_list":
            return respond(await slackClient.getEmojiList(a.verbose as boolean | undefined));

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            },
          ],
        };
      }
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("Received ListToolsRequest");
    return {
      tools: [
        listChannelsTool,
        searchChannelsTool,
        listDmsTool,
        searchMessagesTool,
        postMessageTool,
        scheduleMessageTool,
        replyToThreadTool,
        addReactionTool,
        getReactionsTool,
        getChannelHistoryTool,
        getThreadRepliesTool,
        getUsersTool,
        getUserProfileTool,
        lookupUserByEmailTool,
        listChannelMembersTool,
        createConversationTool,
        uploadFileTool,
        getEmojiListTool,
      ],
    };
  });

  const transport = new StdioServerTransport();
  console.error("Connecting server to transport...");
  await server.connect(transport);

  console.error("Slack MCP Server running on stdio");
}

if (process.argv[1]?.endsWith("index.js")) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
