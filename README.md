# Slack User MCP Server
[![CI](https://github.com/lars-hagen/slack-user-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lars-hagen/slack-user-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/lars-hagen/slack-user-mcp/blob/main/LICENSE)
[![Security Policy](https://img.shields.io/badge/security-policy-blue.svg)](https://github.com/lars-hagen/slack-user-mcp/blob/main/SECURITY.md)

MCP Server for the Slack API, enabling Claude to interact with Slack workspaces as a user.

## Tools

1. `slack_list_channels`
   - List public channels in the workspace
   - Optional inputs:
     - `limit` (number, default: 100, max: 200): Maximum number of channels to return
     - `cursor` (string): Pagination cursor for next page
   - Returns: List of channels with their IDs and information

2. `slack_post_message`
   - Post a new message to a Slack channel
   - Required inputs:
     - `channel_id` (string): The ID of the channel to post to
     - `text` (string): The message text to post
   - Returns: Message posting confirmation and timestamp

3. `slack_reply_to_thread`
   - Reply to a specific message thread
   - Required inputs:
     - `channel_id` (string): The channel containing the thread
     - `thread_ts` (string): Timestamp of the parent message
     - `text` (string): The reply text
   - Returns: Reply confirmation and timestamp

4. `slack_add_reaction`
   - Add an emoji reaction to a message
   - Required inputs:
     - `channel_id` (string): The channel containing the message
     - `timestamp` (string): Message timestamp to react to
     - `reaction` (string): Emoji name without colons
   - Returns: Reaction confirmation

5. `slack_get_channel_history`
   - Get recent messages from a channel
   - Required inputs:
     - `channel_id` (string): The channel ID
   - Optional inputs:
     - `limit` (number, default: 10): Number of messages to retrieve
   - Returns: List of messages with their content and metadata

6. `slack_get_thread_replies`
   - Get all replies in a message thread
   - Required inputs:
     - `channel_id` (string): The channel containing the thread
     - `thread_ts` (string): Timestamp of the parent message
   - Returns: List of replies with their content and metadata


7. `slack_get_users`
   - Get list of workspace users with basic profile information
   - Optional inputs:
     - `cursor` (string): Pagination cursor for next page
     - `limit` (number, default: 100, max: 200): Maximum users to return
   - Returns: List of users with their basic profiles

8. `slack_get_user_profile`
   - Get detailed profile information for a specific user
   - Required inputs:
     - `user_id` (string): The user's ID
   - Returns: Detailed user profile information

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
