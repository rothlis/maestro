---
name: build
description: Build one task — read it and its spec, plan in native plan mode, write the code, open the draft pull request that closes it, and record what landed on the spec. This is the only maestro mode that changes code.
argument-hint: "[task reference, or a project name to pick one from]"
---

# Build

Take one task, and turn it into a draft pull request that closes it. This is the **only**
maestro mode that edits code. `research` and `spec` are read-only.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where
`<store>` is config `store` (default `github`).

**There is no plan document.** Claude plans well from a requirement already, and a plan
document dies with the pull request that implements it. Native plan mode does that job, and
the task is the record that outlives the session.

Build does not restate what another file owns. It **reads** the blueprint for every path it
changes, and it **names** sibling skills rather than repeating them: `/maestro:maestro review`
for the quality pass, `/simplify` for a simplification pass when it is installed, and a
plain-English writing skill for prose when one is installed.

**Build offers the quality passes, and never launches one unasked.** A writing skill is part
of writing, so run it when it is installed. `/maestro:maestro review` and `/simplify` are the
author's call.

## Configuration

Read the config once, at the start, as [../SKILL.md](../SKILL.md) says. Every field has a
default, and a missing file means every default. The defaults below are the team ones.

| Field                 | Default                             | Used in   |
| --------------------- | ----------------------------------- | --------- |
| `store`               | `github`                            | every step that reads or writes an artifact |
| `baseBranch`          | `main`                              | steps 7–8 |
| `memoryDir`           | `.maestro/memory`                   | steps 2, 10 |
| `blueprintMap`        | `.maestro/blueprints/map.json`      | steps 4–6 |
| `prTemplate`          | `.github/pull_request_template.md`  | step 8    |
| `branchPattern`       | none: plain kebab-case              | step 8    |

## Workflow

### 1. Take a task

Read the task reference from the argument. With no argument, walk down the project with
**children**: its specs, then the open tasks of each spec, with the assignee of each. Ask
which one.

**Then assign the task to the user**, with **assign**. If it is already assigned to somebody
else, ask before you take it over. When the store's **link PR** says that merging closes
nothing, close first each open task of the spec whose pull request merged.

**One build is one task.**

### 2. Read the tree above it

A task is the leaf of a tree, and the tree holds why it exists. **Read** each of these:

1. **The task.** What it delivers, its constraints, and the proof it names.
2. **Its spec**, from the `**Spec**` field. Read the requirements the task names, and their
   `<details>` blocks. The acceptance criteria are what "done" means.
3. **The research** of the project, for the architecture and the rejected alternatives.
4. **Shared project memory.** Scan `<memoryDir>/MEMORY.md` and read every fact whose hook
   looks relevant. See [../memory.md](../memory.md).

### 3. Gate on the open questions

Read the spec's **Open questions**. If an unresolved question blocks a requirement this task
carries, **stop and work through it with the user before any code**. Resolve it, or mark it
deferred with a reason, and **replace body** of the spec.

A deferred question is acceptable, because the team then chose to go on with the uncertainty.
An unaddressed one is not.

### 4. Plan in native plan mode

Call `EnterPlanMode`. **Read the blueprint for every path you will touch, before you design
anything.** The blueprint map ties each path to its blueprint: match the path against the
`paths` of each surface, and the narrowest match wins. The blueprint decides where code lives
and how it is wired, and the plan is where those decisions are made. Do not improvise what a
blueprint already states. Then explore the code, design the approach, and present it with
`ExitPlanMode` for approval. Write no file before that approval.

If the repository has no blueprint map, say so once, and follow the patterns of the code
around the change.

**When a blueprint says how to find a home and a precedent for new code, the plan names both
for each piece it adds.** The user can then dispute a design before the code exists, and
`/maestro:maestro review` checks the same two things after.

This step replaces the plan document. What the plan mode produces is a plan for this session,
and the task and the pull request are what the team reads later.

### 5. Write the code

Work through the change with `TaskCreate`, `TaskUpdate` and `TaskList` for the in-session
working set. The task stays the cross-session record.

- **If you touch a path the plan did not name, read its blueprint first.**
- **Use sub-agents** for exploration that would bloat this context. Fire independent ones in
  one message. Do the edits here, in the main context.
- **Write the tests the task names.** Follow the patterns of the package you are changing.

If a task turns out to be blocked or wrong, say so. Never skip it in silence.

**When an instruction contradicts a requirement, offer the spec edit before you write the
code.** You read the task's requirements in step 2, so you are holding the thing the
instruction disagrees with. Say which requirement it contradicts, and what the new wording
would be. Then write both, in one change. The spec is the requirement record for a
task, so the criteria you read in step 2 are the ones to check the instruction against.
**Offer it now, while the person who can approve it is still there**, and not after the pull
request opens. A requirement the code made false is read as true forever.

**Write no requirement the author has not approved.** Offer the wording and wait. A spec
edited without them is the same fault in the other direction.

### 6. Verify

Run the checks for the packages you changed, and report what they said:

- **Typecheck**, scoped to the package when the repository allows it. Never the whole
  repository when one package will do.
- **Tests** — the suites covering the change.
- **Lint** — in the affected package. Read the whole output.
- **The thing you changed.** A tooling change is proven by one real invocation, and a
  user-visible change by the running app. A read proves neither.
- **The Proof section of each blueprint you read in steps 4 and 5.** It names the evidence for
  its surface, and that evidence goes past the three commands above. Read it again now,
  and supply what it names for the code you wrote.

**Check that the evidence the task named exists, file by file.** The task names its
proof, and each acceptance criterion names its own. A test that nobody wrote cannot fail,
so the suite is green and the record reads as covered. Tasks get ticked that way, and a later
review finds them one pull request at a time. The check is mechanical, because the task names
the path:

```bash
ls <the test path the task names>
```

**A path that is absent is an unfinished task**, and never a `done` you write in step 9.
Write the test, or say in the pull request and on the task that the proof moved,
and where it went.

### 7. Size the branch before the pull request exists

Apply the standard in [the pr-shape reference](../references/pr-shape.md), and restate none
of its numbers. The script counts:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pr-shape/report.mjs <base> --json
```

**`<base>` is the branch the pull request targets, and not always `origin/<baseBranch>`.** A
stacked pull request measured against `origin/<baseBranch>` counts the branch below it as
well. Never diff against a local base branch, which adds the upstream commits it is missing.

The script gives the size and the concern signals. You judge the tangle: could one half merge
on its own, is this a vertical slice or a horizontal one, does any commit mix a refactor with
a behavior change.

**Run this step every time.** `/maestro:maestro review` answers the same question against the
same standard, but it runs only after the pull request opens, and it is optional. So this step
is the only reading that always happens. The cheapest moment to move a second concern out is
before the pull request exists.

**When the branch carries two concerns, offer a second task before the pull request opens.**
A mid-build discovery becomes its own task, and **it never extends an open pull request**.
**Create** it as a task under the same spec, with the task body in `spec/SKILL.md`, in the
spec's milestone when it has one.

### 8. Open the draft pull request

**Name the branch from `branchPattern` when it is set**, such as `"<type>/<slug>"`. `<type>`
is the kind of change (feat, fix), so the branch is `feat/add-export-button`. `<n>` is optional
(e.g. `sprint-<n>/<slug>`), taken from the user or the newest matching branch, never guessed.
With `<n>`, the title starts with the same period: `Sprint 4: Add export button`. **Without
the field, the branch is plain kebab-case**, `add-export-button`, and the title is the
description alone.

```bash
gh pr create --draft --base <base> --title "<title>" --body-file <path>
```

The body carries the **link PR** text of the store for each task it closes, such as
`Closes #12` or `Fixes ENG-123`. **That line joins the pull request to the tree.** A pull
request closes one or more tasks.

Then check the link from the pull request back to the task, as **link PR** says. Never take
the line as proof on its own.

**The body follows the file at `prTemplate`, when it exists.** Read it before you write the
body. When it does not exist, write a short Why, a What, and how the change was proven, and
keep the **link PR** line.

**Then offer `/maestro:maestro review` on the pull request, and wait for the answer.** The
review reads the pushed head, so push before you offer it. Say what it costs, so the answer is
informed: [the review skill](../review/SKILL.md) gives the time of one pass, and each
re-check after a fix is a full run again. That is the author's budget and the author's time.

Never launch it because the step exists. A build that reviews itself every run teaches the
author to stop reading the result.

### 9. Record what landed on the spec

The spec is the living artifact, and this is the step that keeps it true.

Write `` `done` `` on the requirement's line, name the pull request there, and check the
acceptance criteria that are satisfied. **The rules for that edit — the bundled-criterion
split, the superseded-criterion strike-through, and the golden rule that a worked requirement
is never deleted — live in [../spec/SKILL.md](../spec/SKILL.md), under "After a build
lands".** Restate none of them here.

**Read** the spec again before you edit it, because it can have changed since step 2. Then
**replace body**.

### 10. Record a durable learning, when there is one

**Most builds produce none.** Write a fact in `<memoryDir>/` only when it is durable and
cross-cutting, and not already carried by the code, the git history, the spec or the
repository's `CLAUDE.md`. Check for an existing fact to update first: when one already says
it, add 1 to its `seen`, and propose a blueprint rule when it reaches 3. The format and the
promotion rules are in [../memory.md](../memory.md).

## What build does not do

- It writes no plan document, and no file under `docs/plans/`.
- It does not extend an open pull request with a second concern. That is a new task.
- It does not restate the pull request shape numbers, the spec edit rules, or a blueprint.
- It does not launch `/maestro:maestro review` or `/simplify`. It offers each one, and the
  author decides.
- It does not mark the pull request ready or announce it. `/maestro:maestro announce` does
  both, after one question.
- It commits and pushes when the user asks, and follows the git workflow of the repository.
