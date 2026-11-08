# Chat: Microsoft Teams

Read this file when `announce.chat` in the config is `teams`. It holds every Microsoft Teams
detail that `announce` needs, and the mode holds none.

## Tools

**Use the Microsoft Teams MCP that is connected**, or a Microsoft 365 MCP that reaches Teams.
Find its tools by what they do: list teams and channels, send a channel message, reply to a
message, search users, send a chat message. They can be deferred, so load them before you call
one. **Read the description of the send tool before you write the message.** It says which
body format the tool takes and how it writes a mention, and the rest of this file depends on
those two answers.

## The channel

A Teams channel lives inside a team. `announce.channel` names both, as
`<team> / <channel>`, such as `Engineering / pull-requests`. Resolve the team id, then the
channel id, once per invocation. Send and reply with both ids. If the field names a channel
only, ask the author for the team.

## A mention

A plain `@Name` notifies nobody. A mention needs the person's directory id (the Microsoft Entra
user id). Find it with the user search tool, by the email that `gh api users/<login>` gives,
or by the name.

Write the mention in the form that the send tool asks for. With the Microsoft Graph message
format, a mention is `<at id="0">Name</at>` in an HTML body, plus one entry in the message's
`mentions` list that ties `id` 0 to the user id. Number each mention from 0. **If the send
tool cannot mention, write each name in plain text, and say in step 5 that nobody will get a
notification.**

## The format

**A Teams channel message is HTML or plain text.** Standard Markdown often shows raw. When the
send tool takes HTML, convert the message of `announce` before you send it:

| Markdown          | HTML                      |
| ----------------- | ------------------------- |
| `**bold**`        | `<b>bold</b>`             |
| `[text](url)`     | `<a href="url">text</a>`  |
| `> quote`         | `<blockquote>quote</blockquote>` |
| `- item`          | `<ul><li>item</li></ul>`  |
| a blank line      | a new `<p>`               |
| `` `code` ``      | `<code>code</code>`       |

When the send tool says it takes Markdown, send Markdown. Leave the subject of a channel post
empty: the headline of the message is the subject.

## A thread reply

Reply to the parent message, with its message id, in the same team and channel.

## A preview in a direct message

Send it in a one-to-one chat with the author, and write each mention as the plain name, so
that nobody gets a notification.

## Limits

- Teams shows no `:shortcode:` emoji. Write the emoji character itself, such as 👀.
- A private or a shared channel can refuse a post from an app that is not a member of it. If
  the send fails for that reason, say so, and offer the text to paste.
- Without a Teams MCP, `announce` cannot post. Say so, and offer the final text to paste.
