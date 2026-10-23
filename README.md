# Slack User MCP Server
[![CI](https://github.com/lars-hagen/slack-user-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lars-hagen/slack-user-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lars-hagen/slack-user-mcp/blob/main/LICENSE)
[![Security Policy](https://img.shields.io/badge/security-policy-blue.svg)](https://github.com/lars-hagen/slack-user-mcp/blob/main/SECURITY.md)

MCP Server for the Slack API, enabling Claude to interact with Slack workspaces as a user.

## Tools

All read tools return **compact projections** by default (trimmed fields, message text truncated at 500 chars) to keep responses token-efficient. Pass `verbose: true` on any read tool to get the full raw Slack object.

1. `slack_list_channels`
   - List conversations in the workspace
   - Optional inputs:
     - `limit` (number, default: 20, max: 200): Maximum number of channels to return
     - `cursor` (string): Pagination cursor for next page
     - `types` (string): Comma-separated `public_channel,private_channel,im,mpim` (default: `public_channel`)
     - `name_filter` (string): Only channels whose name contains this substring
     - `include_archived` (boolean, default: false)
     - `verbose` (boolean)
   - Returns: List of channels with their IDs and information

2. `slack_search_channels`
   - Find channels by name across public and private channels (paged scan, most efficient way to resolve a channel name to an ID)
   - Required inputs: `query` (string): Name substring
   - Optional inputs: `limit` (number, default: 10), `verbose`

3. `slack_list_dms`
   - List your DM and group-DM conversations, most recently updated first (requires `im:read`/`mpim:read`)
   - Optional inputs: `limit` (number, default: 20), `cursor`, `verbose`

4. `slack_search_messages`
   - Workspace-wide message search with Slack modifiers (`in:#channel`, `from:@user`, `after:YYYY-MM-DD`, `has:link`, …). Requires `search:read`
   - Required inputs: `query` (string)
   - Optional inputs: `count` (default: 20, max: 100), `page`, `sort` (`score`|`timestamp`), `sort_dir`, `verbose`

5. `slack_post_message`
   - Post a new message to any conversation (channel or DM)
   - Required inputs: `channel_id`, `text`

6. `slack_schedule_message`
   - Schedule a message for future delivery
   - Required inputs: `channel_id`, `text`, `post_at` (number, Unix epoch seconds)

7. `slack_reply_to_thread`
   - Reply to a specific message thread
   - Required inputs: `channel_id`, `thread_ts`, `text`

8. `slack_add_reaction`
   - Add an emoji reaction to a message (requires `reactions:write`)
   - Required inputs: `channel_id`, `timestamp`, `reaction` (emoji name without colons)

9. `slack_get_reactions`
   - Get the emoji reactions on a message (requires `reactions:read`)
   - Required inputs: `channel_id`, `timestamp`

10. `slack_get_channel_history`
    - Get messages from a channel or DM
    - Required inputs: `channel_id`
    - Optional inputs:
      - `limit` (number, default: 20)
      - `oldest` / `latest` (string): Slack ts bounds — use for time-window queries like "today"
      - `cursor`, `verbose`

11. `slack_get_thread_replies`
    - Get replies in a message thread
    - Required inputs: `channel_id`, `thread_ts`
    - Optional inputs: `limit` (default: 50), `oldest`, `latest`, `verbose`

12. `slack_get_users`
    - List workspace users (compact profiles)
    - Optional inputs: `cursor`, `limit` (default: 50, max: 200), `name_filter` (string), `verbose`

13. `slack_get_user_profile`
    - Get detailed profile information for a specific user
    - Required inputs: `user_id`

14. `slack_lookup_user_by_email`
    - Find a user by email address (requires `users:read.email`)
    - Required inputs: `email`

15. `slack_list_channel_members`
    - List user IDs of members of a channel/conversation
    - Required inputs: `channel_id`
    - Optional inputs: `limit` (default: 100), `cursor`

16. `slack_create_conversation`
    - Create a channel (pass `name`, optional `is_private`) or open a DM/group DM (pass `user_ids`, comma-separated). Requires the matching `channels:write` / `groups:write` / `im:write` / `mpim:write` scope

17. `slack_upload_file`
    - Upload a local file to Slack (two-step external upload), optionally sharing to a channel. Requires `files:write`
    - Required inputs: `file_path` (absolute local path)
    - Optional inputs: `channel_id`, `title`, `initial_comment`

18. `slack_get_emoji_list`
    - List custom emoji in the workspace (names only unless `verbose`)

## Setup

1. Create a Slack App:
   - Visit the [Slack Apps page](https://api.slack.com/apps)
   - Click "Create New App"
   - Choose "From scratch"
   - Name your app and select your workspace

2. Configure User Token Scopes:
   Navigate to "OAuth & Permissions" and add these scopes:
   - `channels:history` - View messages and other content in public channels
   - `channels:read` - View basic channel information
   - `chat:write` - Send messages as yourself
   - `reactions:write` - Add emoji reactions to messages
   - `users:read` - View users and their basic information

3. Install App to Workspace:
   - Click "Install to Workspace" and authorize the app
    - Save the "User OAuth Token" that starts with `xoxp-`.

4. For organization-level tokens, get your Team ID (starts with a `T`) by following [this guidance](https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID#find-your-workspace-or-org-id). It is optional for ordinary workspace tokens.

Treat OAuth tokens as secrets. Do not commit them, put them in issues or pull requests, or paste them into shared configuration. Rotate a token immediately if it is exposed.

### Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`:

#### Local Installation

First install and build the server:
```bash
git clone https://github.com/lars-hagen/slack-user-mcp.git
cd slack-user-mcp
npm install
npm run build
```

Then configure Claude Desktop:
```json
{
  "mcpServers": {
    "slack": {
      "command": "npm",
      "args": [
        "run",
        "--prefix",
        "/path/to/slack-user-mcp",
        "start"
      ],
      "env": {
        "SLACK_TOKEN": "xoxp-your-user-token"
      }
    }
  }
}
```

#### NPX

This project is not published to npm. Do not use an `npx` package name for it. Clone and build it locally as shown above, then use the local configuration.

#### Docker

```json
{
  "mcpServers": {
    "slack": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "SLACK_TOKEN",
        "slack-user-mcp"
      ],
      "env": {
        "SLACK_TOKEN": "xoxp-your-user-token"
      }
    }
  }
}
```

Build the image first with `docker build -t slack-user-mcp .`. Add `-e SLACK_TEAM_ID` and `SLACK_TEAM_ID` to `env` only when using an organization-level token.

### Installing via Smithery

To install Slack User Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@lars-hagen/slack-user-mcp):

```bash
npx -y @smithery/cli install @lars-hagen/slack-user-mcp --client claude
```

### Troubleshooting

If you encounter permission errors, verify that:
1. All required scopes are added to your Slack app
2. The app is properly installed to your workspace
3. The token and, when needed, workspace ID are correctly copied to your configuration
4. The app has been added to the channels it needs to access
5. You're using a User OAuth Token (starts with `xoxp-`) rather than a Bot Token

## Build

Docker build:

```bash
docker build -t slack-user-mcp .
```

## Maintenance status

This project receives focused, best-effort maintenance. It has no support SLA. Please report security concerns privately as described in [SECURITY.md](SECURITY.md).

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
