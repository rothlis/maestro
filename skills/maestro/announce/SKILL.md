---
name: announce
description: Announce one pull request, or a stack of them, in the team's Slack channel, through whatever Slack MCP is connected. For one pull request, writes a headline that says what the PR does, a bold "Why?" line, and one footer line with the reviewers, an FYI that names the teams that must only know (in backticks, no mention), and the verdict of a maestro review at the head commit, and sends no thread reply. The reviewers are the people that the PR requests or that reviewed it, plus the owner from the blueprint map of each touched surface that has none. For a stack, posts a short parent message that links the GitHub stack page and says what the user gets, then a thread reply that says what the stack ships, then one thread reply for each person who has a review, with their question and the points to review. Then asks one set of questions — the people, and whether to mark the PR ready and send — and does nothing before the answer. It does not wait for CI.
argument-hint: "[PR number or URL — several for a stack; none for the current branch]"
---

# Announce a pull request

Turn a pull request into the announcement the team reads, and post it **after one explicit
confirmation**, every time.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where
`<store>` is config `store` (default `github`).

## The one hard rule

**Never send to the channel, and never run `gh pr ready`, before the author answers the
one `AskUserQuestion` call of step 5, in this invocation.** A message that looks like one
approved earlier is not approved. "Post it, don't ask" is not approval either: ask anyway,
once, with the final text on screen, and say that this mode always confirms the wording
and the people before anything reaches the channel.

The whole team reads the channel, a mention notifies a person, and no tool edits a sent
message. The question is cheap, and the mistake is not.

**Do not wait for CI.** Red or still running, the message goes out when the author says so.
Do not poll `gh pr checks`.

## Workflow

### 1. Find the Slack tools and the channel

**Use the Slack MCP that is connected.** Find its tools by what they do: send a message,
search channels, search users, read a thread. They can be deferred, so load them before you
call one. If no Slack tool is connected, say so and stop. Offer the final text, so the author
can paste it.

**The channel is `announce.slackChannel` in `.maestro/config.json`.** If the field is missing,
ask the author for the channel. Then say that `/maestro:maestro setup` saves it in the config,
so that the question does not come back. Resolve
the channel name to its id with the channel search tool, once per invocation.

### 2. Resolve the pull requests

- A number or a URL → `gh pr view <n> --json number,title,url,body,isDraft,baseRefName,headRefName,headRefOid,author,files`
- No argument → the same command with no number, for the current branch's pull request.
- No pull request for the branch → say so and stop. Do not offer to create one.

**Several pull requests, or "the stack"** → resolve each one, then **take the merge order
from `baseRefName`**, never from the order you were given or from the numbers. The one whose
base is the base branch is `[1/N]`, the one based on its branch is `[2/N]`, and so on. A wrong
merge order is the one error a stack exists to prevent.

Record `isDraft` for each one, and continue. A draft becomes part of the question in step 5.

**For a stack, read two more things:**

- **The GitHub stack.** Run `gh api "repos/{owner}/{repo}/stacks?pull_request=<n>"` with any pull request of the stack. Its page is `https://github.com/{owner}/{repo}/stack/<number>`. If nothing comes back, there is no stack page.
- **The spec.** A pull request closes a task, and the parent of that task is the spec. Find the task from the pull request with **link PR**, **read** the task for its parent, then **read** the spec. Read its solution section. If no pull request closes a task, there is no spec.

Read the body. Its Why and What sections are the raw material. Invent nothing that the pull
request or its diff does not say.

### 3. Pick the people

#### Touched surfaces

Both formats start from the blueprint map, at `blueprintMap` in the config
(default `.maestro/blueprints/map.json`). People come from the map, and never from memory.

1. Match each changed file against the `paths` of each surface. A file under a surface's
   blueprint folder belongs to that surface too.
2. **The narrowest surface wins.** When two surfaces match a file, keep the one with the
   longer path before any `*`. `services/billing/` beats `services/*/`, so the message does
   not name the owner of every service on every billing pull request.
3. **Ignore a catch-all surface when another surface matches the same file.** A surface that
   matches every file of a language names the same person on every pull request. A file that
   only the catch-all matches stays with it.
4. A file that matches no surface takes the teams that `uncoveredReviewTeams` gives for its
   path, if any.

If the repository has no blueprint map, say so. The people are then the ones the pull request
names, and nobody else.

#### One pull request: the footer

The message of one pull request ends with one footer line. The footer has three parts, in this order, joined by `·`:

```
**Reviewers:** <@id1> <@id2> · FYI `org/team-a`, `org/team-b` · Approved by maestro review
```

If a part is empty, leave it out. If all three parts are empty, leave out the footer. A single pull request gets no thread reply.

**The reviewers.**

1. Read the people that the pull request requests, or who reviewed it: `gh pr view <n> --json reviewRequests,reviews --jq '[.reviewRequests[].login, .reviews[].author.login] | map(select(. != null)) | unique | .[]'`. Drop the author and every bot. Each person left is a reviewer.
2. For each touched surface, the surface has its reviewer when a reviewer of step 1 is its `owner`, or a member of its `reviewTeam`: `gh api orgs/<org>/teams/<team>/members --paginate --jq '.[].login'`.
3. If a touched surface has no reviewer, add its `owner`. If the owner is the author, the surface gets no reviewer.

**The FYI.** Write the `reviewTeam` of each touched surface as `` `org/team` ``, in backticks, after `FYI`. Never write it as a mention: the FYI tells the reader which teams the change touches, and it notifies nobody.

**The review verdict.** When a maestro review was posted on the pull request, read its verdict
as [the review skill](../review/SKILL.md) records it. Write it only when the review is of the
head commit, `headRefOid`:

- an approval → `Approved by maestro review`
- any other verdict → `Maestro review: <verdict>`, in the review's own words

A verdict on an earlier commit does not count, because a push after it was not reviewed. With
no review at the head, leave the part out.

#### A stack

The rest of this step applies to a stack only.

The review line has two levels. Propose one, and the author decides in step 5.

| Level         | When                                                                                                                                                                 | Line                   | Thread reply |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------ |
| **Reviewers** | The change alters an architecture pattern or a risky part — what the surface's `reviewRisk` file names, a migration, billing, permissions, data deletion, a blueprint — and a specific owner must review it | `**Reviewers:** <@id>` | Yes          |
| **(none)**    | It is contained, small or mechanical, and a review adds nothing                                                                                                      | no line                | No           |

**Mention a person only to ask them a question.** A mention notifies the person, and a mention with nothing to answer is noise. So a stack has no FYI: when no owner has a decision to make, the level is "(none)".

Take the people from the touched surfaces above, and drop the author. Add the people that
each pull request already requests or that reviewed it, as step 1 of the footer reads them.

If no person is left, propose the level "(none)".

##### Only the points that need a review

In a stack, name a person only on a pull request that needs their review: it alters an architecture pattern or a risky part from the "Reviewers" row above, on a surface that the person owns. Note the decision that it holds. A pull request that needs no review names nobody.

An interface between modules counts as a risky part only when the pull request adds it, or changes it so that its callers change. A new optional field needs no review. Without this rule, nearly every pull request is a review.

Write one question for each person who has a review. It asks for the one decision that you need from them. Take it from the pull requests, in your own words, and invent no fact. If you find no question for a person, that person needs no review, and gets no reply. Step 5 shows each question to the author.

#### Slack ids

A mention is `<@U…>` with the Slack member id. A plain `@Name` notifies nobody. Resolve each
GitHub login with the user search tool, by the name or the email that
`gh api users/<login>` gives. **If the search does not return exactly one person, ask the
author.** Never guess, because a wrong mention notifies a stranger.

### 4. Write the message

**Write what your Slack tool expects.** Many Slack send tools convert standard Markdown:
`**bold**`, `[text](url)`. With such a tool, Slack's own `*bold*` or `<url|text>` shows up raw
in the channel. A message read back from Slack shows mrkdwn, because Slack stores it that way.
That is not a reason to write mrkdwn.

#### One pull request

```
**[#<number> <what it does>](<pr-url>)**

**Why?** <one sentence>

**Reviewers:** <@id> · FYI `<org/team>` · Approved by maestro review
```

**A blank line separates each line of the message**, in both formats, so that each line reads
on its own in the channel. The exception is a bulleted list, which stays together.

- **The headline says what the pull request does**, for a reader who does not know the
  project. The number opens the link text as `#<number>`, then the project, then the what.
  Strip the `branchPattern` period prefix from the title, such as `Sprint 4:`, if there is one. Keep it to one line, about 12 words.
- **The "Why?" line is one sentence**, about 20 words, taken from the Why section of the
  body. It states the problem for a reader, and not the mechanism of the fix.
- **The footer** follows step 3. It is one line, and the message has no thread reply. A
  question in a thread made readers unsure whether a reply was expected, and from whom.

#### A stack

A stack sends three kinds of message: a short parent message, one reply with the context, and one reply for each person. The parent reads like a short release note, and it mentions nobody.

```
**[<what the stack does>: <N> PRs](<stack-url>)**

<what the user gets, in two sentences>

Behind the `<flag>` flag. The details and the reviews are in the thread.
```

- **The header is a short description of what the pull requests do together**, about 8
  words, for a reader who does not know the project. For example: "Invoices that send
  themselves". Do not start it with a stock phrase such as "Progress on". Strip the period
  prefix.
- **The header links the stack page.** The page lists the pull requests, so no message does. If step 2 found no GitHub stack, link the bottom pull request, and list the pull requests at the top of the context reply: `- [n/N] **[#<number> <what it does>](<pr-url>)**`, in merge order, bottom first.
- **"What the user gets" is two sentences, from the solution section of the spec.** The first says what the user cannot do today, and the second says what they can do with this stack. Do not describe the mechanism. If there is no spec, write it from the Why sections of the pull requests, and say so in step 5.
- **Write "Behind the `<flag>` flag." only when a flag hides the work.**

**The context reply** is the first reply in the thread:

```
**In this stack:**
- **<part>.** <one or two short sentences>
- **<part>.** <one or two short sentences>

**Not in this stack yet:** <one sentence>
```

- **"In this stack" groups the pull requests by what they give**, in 3 to 5 bullets of one or two short sentences, and not one bullet for each pull request. Take each part from the first lines of the pull requests.
- **"Not in this stack yet" comes from the "Next steps" sections of the pull requests.** Name what a reader expects and does not get yet. If the stack completes the work, leave the line out.

**One reply for each person who has a question** follows, the person with the most reviews first. The reply opens with the mention, because the parent mentions nobody:

```
:eyes: **Review for <@id>: <n> PRs**

> **Question:** <the one decision that you need from them>
>
> **<The point to review>** <the rest of the sentence>. [#<number>](<pr-url>)
>
> **<The point to review>** <the rest of the sentence>. [#<number>](<pr-url>) · [#<number>](<pr-url>)
```

- **Formatting decides whether the reply is read.** Slack shows replies sent back to back by one person under one name, so each reply marks its own edges. The `:eyes:` header shows where a reply starts, and the blockquote shows where it ends.
- **Keep an empty `>` line between the question and each point**, so that each one stands alone.
- **The question comes first**, under the header, because it is the one thing that the person answers.
- **Each point is one short sentence**, led by the point in bold, about 10 words in all. Write no file name and no inline code: the pull request shows both.
- **Link each pull request itself** after the sentence. Join the pull requests that share one decision on one point, such as two migrations or three new interfaces, so that a long reply stays short.

**Keep a qualifier that changes what a number means**, and scope every frequency claim to what
you measured. A wrong number in the channel gets quoted back.

### 5. Show it, then ask once

Print the exact message and each thread reply. Say in one line which pull requests are
drafts. Then make **one `AskUserQuestion` call with these questions, together**:

1. **Reviewers** — multi select, the proposed people first with "(Recommended)", then the
   other owners in the blueprint map, without the author, then **No one** last. When nobody
   is proposed, "No one" goes first with "(Recommended)". The picker holds four options, so an
   owner who does not fit is typed in "Other". "No one" removes the "Reviewers:" part, and
   keeps the FYI and the verdict.
2. **Action** — single select. Give each option that sends a `preview` with the full message
   and the proposed people, so the author reads the exact text:
   - **Mark ready and post** (Recommended) — `gh pr ready` for each draft, then send.
   - **Post only** — send, and leave the draft state as it is. It goes first when no pull
     request is a draft, and "Mark ready and post" is then left out.
   - **Mark ready only** — the author posts later, or not at all.
   - **Revise** — the author says what to change.

**The answers decide the message.** Send the preview with the chosen people in place of the
proposed ones, and change nothing else. Ask the whole set again when:

- the author chose "Revise", or typed a free answer in "Other";
- "No one" was chosen together with a person.

**For a stack, ask other questions.** A stack gives a level to each person on each pull request, and a picker cannot hold that. So the one `AskUserQuestion` call holds these questions:

1. **Review plan** — single select. **As proposed** (Recommended) has a `preview` with the full message and every thread reply. **Change it** lets the author name the person, the level or the question to change, in "Other". **No people** posts the parent message and the context reply, and no reply for a person.
2. **Action** — the same as above.

Ask the whole set again when the author chose "Change it" or "Revise", or typed a free answer in "Other".

Mention anything that can start noise in the channel, such as a cost or a low metric, once,
and offer to move it into the thread.

A preview in a direct message is sent only if the author asks for it. Send it to their own
Slack id, and write each mention as plain `@Name`, so that nobody gets a notification. Then
ask again.

### 6. Do what the author agreed to

In this order:

1. **Mark ready**, if agreed: `gh pr ready <n>` for each draft, bottom of the stack first. If
   one fails, say so and ask before you send a message about a pull request that is not ready.
2. **Send** the confirmed text, verbatim, to the channel id from step 1.
3. **Reply in the thread, for a stack only.** Send the context reply first, then one reply for each person. Use the same tool, with the thread set to the
   timestamp of the parent message. A single pull request gets no thread reply.
4. Give back the link of each message you sent.

**Do not request a GitHub reviewer**, on one pull request or on a stack. A person named in the
message gets the Slack mention only. A second request on top of the ones the repository
already makes gives the pull request two reviewers for one review.

## Limits

- **No tool edits or deletes a sent message.** Every revision is a new message, which is why
  the iteration happens in the conversation. If previews were sent to a direct message, tell
  the author to delete the stale ones.
- Custom emoji exist only in the workspace that added them. The formats above use standard
  emoji only.
- A Slack Connect channel can refuse a post from an app. If the send fails for that reason,
  say so, and offer the text to paste.
