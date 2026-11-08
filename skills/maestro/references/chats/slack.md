# Chat: Slack

Read this file when `announce.chat` in the config is `slack`, or when the field is missing.
It holds every Slack detail that `announce` needs, and the mode holds none.

## Tools

**Use the Slack MCP that is connected.** Find its tools by what they do: send a message,
search channels, search users, read a thread. They can be deferred, so load them before you
call one.

## The channel

`announce.channel` is a channel name, such as `#pull-requests`. Resolve it to its id with the
channel search tool, once per invocation. Send and reply with the id.

## A mention

A mention is `<@U…>`, with the Slack member id. A plain `@Name` notifies nobody. Find the id
with the user search tool, by the name or the email that `gh api users/<login>` gives.

## The format

**Write what your Slack tool expects.** Many Slack send tools convert standard Markdown:
`**bold**`, `[text](url)`. With such a tool, Slack's own `*bold*` or `<url|text>` shows up raw
in the channel. A message read back from Slack shows mrkdwn, because Slack stores it that way.
That is not a reason to write mrkdwn.

## A thread reply

Send it with the same tool, with the thread set to the timestamp of the parent message.

## A preview in a direct message

Send it to the author's own Slack id, and write each mention as plain `@Name`, so that nobody
gets a notification.

## Limits

- Custom emoji exist only in the workspace that added them. Use standard emoji.
- A Slack Connect channel can refuse a post from an app. If the send fails for that reason,
  say so, and offer the text to paste.
