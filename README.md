# Slack User MCP Server

MCP Server for the Slack API, enabling Claude to interact with Slack workspaces as a user.

<a href="https://glama.ai/mcp/servers/wc0u5519qh"><img width="380" height="200" src="https://glama.ai/mcp/servers/wc0u5519qh/badge" alt="Slack User Server MCP server" /></a>

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

4. Install App to Workspace:
   - Click "Install to Workspace" and authorize the app
   - Save the "User OAuth Token" that starts with `xoxp-`

5. Get your Team ID (starts with a `T`) by following [this guidance](https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID#find-your-workspace-or-org-id)

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
        "SLACK_TOKEN": "xoxp-your-user-token",
        "SLACK_TEAM_ID": "T01234567"
      }
    }
  }
}
```

#### NPX

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-slack-user"
      ],
      "env": {
        "SLACK_TOKEN": "xoxp-your-user-token",
        "SLACK_TEAM_ID": "T01234567"
      }
    }
  }
}
```

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
        "-e",
        "SLACK_TEAM_ID",
        "mcp/slack-user"
      ],
      "env": {
        "SLACK_TOKEN": "xoxp-your-user-token",
        "SLACK_TEAM_ID": "T01234567"
      }
    }
  }
}
```

### Troubleshooting

If you encounter permission errors, verify that:
1. All required scopes are added to your Slack app
2. The app is properly installed to your workspace
3. The tokens and workspace ID are correctly copied to your configuration
4. The app has been added to the channels it needs to access
5. You're using a User OAuth Token (starts with xoxp-) not a Bot Token

## Build

Docker build:

```bash
docker build -t mcp/slack-user -f src/slack/Dockerfile .
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
