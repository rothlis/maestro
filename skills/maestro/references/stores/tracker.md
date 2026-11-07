# Store: a tracker, through its MCP

Read this file when `store` in `.maestro/config.json` is `tracker`. The artifacts then live in
the team's tracker, such as Linear or Jira, and a mode reaches them through the tracker's MCP
tools. Pull requests and the review stay on GitHub.

Each section below is one store operation. The modes name the operation in bold, and this
file says how to run it through the tracker.

## The mapping

`tracker.instructions` in `.maestro/config.json` is free text. It names the MCP, and it says
how each artifact maps onto the tracker. For example:

> Linear MCP. project = Linear project. spec = issue labelled spec in that project. task =
> sub-issue of its spec. research = Linear document in the project. milestone = project
> milestone. A PR links a task with `Fixes ENG-123` in its body.

A **reference** is how the tracker names one artifact in text, such as `ENG-123` on Linear or
`PROJ-45` on Jira. Use it wherever a mode writes `<ref>`.

**When `tracker.instructions` is missing or empty**, ask the user for the mapping once, before
the first operation. Ask for each item the mapping needs (see **ready**). Then offer to save
it to `tracker.instructions`, so that the next run asks nothing.

## ready

Run this once per session, before the first other operation.

1. **Find the tools.** Search with `ToolSearch` for the tracker's name, such as `linear` or
   `jira`. MCP tools are often deferred, so load them before you call one. If no tool comes
   back, say that the MCP is not connected, and stop. Write nothing anywhere else instead.
2. **Map each operation to a tool**, from the mapping and the tool descriptions. The
   mapping must say:
   - which tracker object each kind is: project, research, spec, task;
   - how a child joins its parent: a sub-issue, a project field, a "parent" relation, or a
     body line `Parent: <ref>`;
   - what a milestone is, or that the tracker has none;
   - which statuses mean done;
   - the **link PR** text, and whether merging a pull request closes the task.
3. **Confirm the mapping with the user the first time**: show each operation with the tool
   and the object it uses, and ask with `AskUserQuestion`. When the user corrects it, offer to
   save the corrected text to `tracker.instructions`.

**Never create a label, a status, a field or a workflow state that the mapping does not
name.** Ask instead. A tracker is shared, and a new field shows up on every team's board.

## find projects

List the project artifacts, open and closed: completed, cancelled and archived ones too. A
default list often hides them, and a closed project then looks absent, so a second one gets
created.

## create

Create the artifact of the kind, with its title and body, under its parent, by the mapping.
Return its reference.

- Use the title of the kind: `Project: <Name>`, `Research: <Topic>`, `Spec: <Title>`,
  `Task: <what it delivers>`.
- **When the tracker has no parent link**, use the link that the mapping states. If that is
  a body line, put `Parent: <ref>` as the first line of the body.
- Set the milestone in the same call when the tool takes one. Else do **milestones** after.
- Then do **read**, and compare the title, the body and the parent with what you sent. A tool
  can return success and drop a field.

## read

Read the artifact's title, body, status and parent. Map the status to `open` or `done` with
the done statuses of the mapping. Map the parent from the stated link.

## replace body

Write the whole body, then **read** it back and compare it with what you wrote. Exit codes
and success messages are not proof.

- **A tool can return success and change nothing.** Read back after every write.
- **A body update can append instead of replace.** If the read-back holds the old body and
  then the new one, the tool appends. Find the tool or the field that replaces, and do not
  write again until you have it.
- **A tracker's markdown can strip HTML.** The progress section's two markers,
  `<!-- maestro:progress:start -->` and `<!-- maestro:progress:end -->`, are HTML comments.
  If the read-back has no markers, use the fallback: a `## Progress` heading that `sync` owns,
  from that heading to the end of the body. Keep every other heading above it. A `<details>`
  block can be stripped in the same way. Then keep its content as plain text under its
  `<summary>` line, and tell the user once.
- Never send an empty body. Make sure that the text you send is not empty before you send it.

## children

List the artifact's children, with the kind and the status of each, by the parent link of
the mapping. Include the done children. A list that hides them gives a wrong count.

When the link is a body line `Parent: <ref>`, search for that line, and keep only the
artifacts of the kinds you expect.

## milestones

Use the tracker object that the mapping names, such as a Linear project milestone or a Jira
fix version.

- **List** the project's milestones, closed ones too, with the due date when the tracker
  holds one.
- **Create** one only after the user names it. When the tracker's milestones belong to one
  project, the title is the bare name. When they are shared across projects, the title is
  `<project-slug>/<milestone-name>`, so the prefix ties it to one project.
- **Set** an artifact's milestone through the field the mapping names.

When the mapping says the tracker has no milestones, say so, and treat each artifact as having
none. Do not invent a label or a field to stand in for one.

## close

Move the artifact to a done status that the mapping names. When there are several, ask once
which one means "done", and offer to save the answer to the mapping.

## link PR

The mapping states the text a pull request body carries so that merging it closes the task,
such as `Fixes ENG-123`. Put one line per task in the body.

- **When merging does not close the task**, because the tracker has no GitHub integration,
  **close** the task after the pull request merges, or say that it is still open.
- **From a pull request to its task:** search the pull request body and the branch name for
  references of the tracker's form, such as `ENG-123`. Then **read** each one, and keep only
  the tasks. Its spec is the task's parent.
- **From a task to its pull requests:** many trackers attach the pull request to the task.
  Read the attachment through the MCP. Else search GitHub for the reference:
  `gh pr list --state all --search "<ref> in:body"`.
