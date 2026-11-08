---
name: spec
description: Write the spec under a project — the requirements for one part of the work, as sections of one spec, in at most one milestone — then propose the tasks a pull request will close, and create them after the author approves.
argument-hint: "[optional spec name, or the reference of a spec to iterate on]"
---

# Spec

If the config sets `method` to `shape-up`, read `../references/methods/shape-up.md` and apply its section for this mode.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where
`<store>` is config `store` (default `github`).

A spec says **what** the product does when the work is done. It never says how the code
works. The spec is one artifact under the project, and its requirements are its sections.
**The spec is the unit of progress**: `/maestro:maestro sync` counts per spec.

The spec then creates the first tasks. Once the author approves them, a task is cheap:
anybody adds one when the work appears.

Use ultrathink for maximum reasoning depth.

**Nothing forces the size of a spec.** The author decides it. A part of the work that carries
unknowns earns a spec of its own.

## Namespace system

Every requirement carries a namespaced identifier, so that two specs in one project never
collide.

**The base namespace comes from the project name.** Split the kebab-case name on hyphens, take
the first letter of each word, and put it in upper case.

| Project                   | Namespace | Example      |
| ------------------------- | --------- | ------------ |
| `bulk-invoice-export`     | `BIE`     | `BIE-REQ-1`  |
| `fix-login-redirect-loop` | `FLRL`    | `FLRL-REQ-3` |
| `search-result-ranking`   | `SRR`     | `SRR-REQ-2`  |

Confirm the namespace with the user, and write it in the `**Namespace**` field of the spec
body.

### The milestone segment

A project with several milestones can add a milestone segment, so that identifiers never
collide across specs: `<PROJECT>-<MILESTONE>-REQ-N`. Derive the segment the same way from the
milestone name, or take a short tag of one to three letters from the user.

| Project        | Milestone                      | Namespace | Example       |
| -------------- | ------------------------------ | --------- | ------------- |
| `team-billing` | `team-billing/seat-limits`     | `TB-SL`   | `TB-SL-REQ-1` |
| `team-billing` | `team-billing/invoice-history` | `TB-IH`   | `TB-IH-REQ-1` |

The segment is optional and never forced:

- **A project with one spec stays flat** (`TB-REQ-N`).
- **A second spec in the same project is the signal.** Suggest a segment for the new spec.
  The user can decline. Do not relabel the first spec unless the user asks for it.

**Collision rule.** If two milestones derive the same segment, such as `publish-list` and
`plan-limits` which both give `PL`, extend one with its next significant letter (`PUL` and
`PLL`), or ask the user for a short tag. The same rule applies to the base namespace.

## Workflow

### 1. Find the project

**Find projects**, and take the one whose name matches.

If no project exists, offer to run `/maestro:maestro init` first. A spec is a child of the
project, so the project must exist before this mode writes anything.

If the argument is the reference of a spec, **read** that spec. This is iteration mode. Go to
step 7.

### 2. Pick the milestone

A milestone is a stage of the project. List the project's **milestones**.

Ask with `AskUserQuestion` which one this spec belongs to. Offer each milestone, **none**, and
a new one. Create a new one through **milestones** only after the user names it.

**A spec belongs to at most one milestone.** A spec that would span two milestones is two
specs. The milestone field is the only link: sync groups specs by it, and nothing else in the
body says where a spec belongs.

List the project's **children**, and count the specs it already holds. A second spec is the
signal for a milestone segment in the namespace.

### 3. Read the research and the memory

1. **The research of the project.** **Read** every research child of the project. Its
   findings and its open questions are what the requirements are derived from. Link each one
   in the `**Research**` field.
2. **Shared project memory.** Scan `<memoryDir>/MEMORY.md` and read every fact whose hook
   looks relevant. Prior decisions say what is already settled, and stop the spec
   re-litigating them. See [../memory.md](../memory.md).

### 4. Explore the codebase

Use codebase exploration sub-agents, in parallel for independent areas. The goal is an
**informed** requirement: what is possible, what already exists, and the rough size.

**The goal is not to pre-plan the implementation.** Carry no file path, function name, class
structure or code pattern into the spec. That detail belongs to the build.

#### Abstraction level

A requirement describes what the product does. Some technical context helps when it explains
an architectural choice or says where the data comes from. Naming a module, a service or a
system is fine.

**Directional context, which belongs here:**

- "Completion state is derived from the existing checkpoint fields and the account data."
- "Dismissal is scoped to the organization, in `localStorage`."
- "The feature is behind the `new-onboarding` flag."

**Exact implementation, which does not:** CSS classes, type signatures, prop lists, file
paths, framework patterns, function names, environment variables, DI tokens, schema field
names.

#### A criterion never weakens a blueprint rule

`/maestro:maestro build` measures a task against its acceptance criteria. So a criterion that
restates a blueprint rule in weaker words lowers the standard for that task, and the build
obeys the weaker words. When a criterion touches a rule, name the rule and keep all of it,
or leave the rule out and let the blueprint hold it.

A criterion once said "A read or a write that throws is caught". A
`catch { return undefined }` met it, and the blueprint said that this is never the answer.
"A storage fault is reported, as the blueprint's error-handling rule requires" keeps the
rule.

### 5. Size each requirement

A requirement becomes one or more tasks, and a task becomes part of one pull request. Size the requirements now, while they are still cheap to move. A pull request that
is too large is corrected by a rebase and a second branch, after the reviewer has already
read it.

For each requirement, make sure that:

- It delivers **one concern**. A refactor and a behavior change are two requirements.
- It is a **vertical slice**. Slice down through the layers, not across them. A requirement
  that delivers all of the backend and then all of the frontend gives one pull request that
  touches everything.
- One pull request can carry it, against the numbers in
  [the pr-shape reference](../references/pr-shape.md). Restate none of them here.

If a requirement fails one of these, split it into two and order them. Some requirements
cannot be split, and a migration with its only consumer is the usual case. Keep that one
whole, and record the intended pull request order inside its `<details>` block.

State the count in **The solution**: how many pull requests the list holds, and how many of
them are small.

### 6. Write the spec

**Create** a spec under the project, titled `Spec: <Title>`, with the body below, in the
milestone the user chose. Leave the milestone out when the user chose none. Then **read** it
back, and compare it with what you sent.

#### The body

The body reads top down, from what a person gets to how the team knows it is done. Use no
horizontal rule (`---`) anywhere. The headings do that work.

```markdown
**Date**: <YYYY-MM-DD>
**Team**: <team>
**Project**: `<project-name>` — <project ref>
**Namespace**: <NS>
**Research**: <research ref>

> One line. What a person can do when this is done.

## The problem

Who has the problem, and what it costs them today. Then the two or three facts about the
code that decide the order of everything below, as a short list with a bold lead. Name the
branch and the commit the research read, and the date.

## The solution

What the product does after this ships, in the words of the person who uses it. Then what
the platform owes, as a numbered list, with each item naming the requirements that deliver
it.

Close with the size: how many pull requests the requirements hold, and how many of them are
small.

### How one <run> works

Optional. One walk through the whole flow, with each step naming the requirement that makes
it possible. Keep it to one scenario. Say underneath which orderings are load-bearing, and
why.

## Requirements

| Id         | Requirement              | Priority |
| ---------- | ------------------------ | -------- |
| <NS>-REQ-1 | <the title, in one line> | `must`   |
| <NS>-REQ-2 | <the title, in one line> | `should` |

One or two lines after the table say where the cut line sits, and how many requirements are
done.

### <NS>-REQ-1: <Requirement Title>

`must` · <task ref> · Depends on <NS>-REQ-2

Two to four lines. What is true when this is done, why it is not true today, and the one
sentence a reader must not miss, in bold.

<details>
<summary>Acceptance criteria and technical notes</summary>

- [ ] Criterion 1. Observable behavior. Naming a module or a service is fine.
- [ ] Criterion 2. A criterion that asserts something no longer happens names the test that
      proves it.

The technical notes follow the criteria in the same block: the constraints, the traps, the
decisions, the rejected alternatives, and the intended pull request order when the
requirement cannot be split.

</details>

## Decisions taken

These are settled, and the requirements above assume them. The research holds the
reasoning.

- ...

## Open questions

> **Do not start execution on an affected requirement until its blocking question is
> resolved.**

- [ ] **<The question>.** Who answers it, and which requirements it affects.
- [x] **<A resolved question>.** The answer, and the requirement that holds the detail.

## Out of scope

- ...

## Tasks

The tasks, in the order they land, each with what it waits on.

1. <task ref> — <what it delivers>.
2. <task ref> — <what it delivers>, after <task ref>.
```

Omit the `**Team**` line when the context does not give it.

#### The collapsed block is the rule, not an option

A person who opens the spec wants the outline of the work. A person who builds one requirement
wants its criteria. The first reader must not pay for the second. So every requirement puts
its acceptance criteria and its technical notes inside the `<details>` block, and keeps
outside only the prose a reader needs to understand the requirement. Keep the visible part to
four lines or fewer.

#### The requirement line

| Part       | When it appears               | Example                 |
| ---------- | ----------------------------- | ----------------------- |
| Priority   | Always, first                 | `` `must` ``            |
| Status     | Only when it is not `pending` | `` `in_progress` ``     |
| Task       | Only when one exists          | `#123`, `ENG-123`       |
| Dependency | Only for a hard dependency    | `Depends on <NS>-REQ-1` |

Divide the parts with `·`. A requirement that is pending, uncut and independent carries its
priority alone.

#### Requirement statuses

| Status        | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `pending`     | Not started. Free to edit, reprioritize or rewrite. It is not written on the line.        |
| `in_progress` | An agent or a person is building it.                                                      |
| `done`        | Complete. The criteria are checked, and the notes name the pull request.                  |
| `cut`         | Removed before the work started. Keep it, with the reason.                                |
| `obsolete`    | Was `done`, and a later pivot made it irrelevant. Keep it, and say what changed.          |
| `moved`       | Transferred to another project. Keep it, and link the destination and the new identifier. |

**Never delete a requirement that has been worked on.** The spec is a historical record. When
priorities shift, change the status.

#### What the body must not hold

- A `---` divider. The headings do that work.
- A `## Context` section. **The problem** and **The solution** replace it.
- A "Key Files Reference", a "Testing Strategy" or a `## Bugs` section.
- **A requirement that no code delivers.** A design file, a QA pass, a rollout, a flag
  toggle or a stakeholder update is not a requirement. It can appear inside a `<details>`
  block as context.

**A bug is a requirement too.** There is no `<NS>-BUG-N` space. A defect is a requirement
whose goal is to make broken behavior work again, and it takes the same form. Keep it in the
`<NS>-REQ-N` sequence, so that one list gives one honest count.

### 7. Propose the tasks

A task is the unit a pull request closes. Propose the first ones now, and create none of them
before the author approves.

Show the user the proposed list: a title, the requirements each task carries, what it waits
on, and one line on what it delivers. Use `AskUserQuestion` for the approval.

For each approved task, **create** a task under the **spec**, titled
`Task: <what it delivers>`, with the body below. **A task takes its spec's milestone**, so the
milestone shows the whole stage.

The task body:

```markdown
**Project**: <project ref> · **Spec**: <spec ref> · **Requirements**: <NS>-REQ-1, <NS>-REQ-2

<What this task delivers, in two to five lines. The constraints that decide its form, in
bold.>

Proof: <how somebody knows it works. Name the command or the run.>
```

Then **replace body** of the spec: write each task reference on its requirement's line, and
fill the **Tasks** section. Start from the body you read, and change only those parts.

### 8. Resolve the open questions

Walk the user through every open question before you finish. For each one: discuss it,
explore the codebase if that resolves it, then either resolve it or mark it **deferred** with
a reason. **Replace body** of the spec as each one is settled.

A deferred question is acceptable. An unaddressed one is not. Do not propose going to build
while a question blocks a requirement.

### 9. Keep the project context current

Read the project again, then apply "The project context" in [../SKILL.md](../SKILL.md). A spec
often moves a scope line: something goes under **Out of scope**, or a decision answers an
open question of the project. Update Context, ask first for a decision or a limit, and write
one line in Changes that names this spec. Do the same when an iteration below changes the
goal. If nothing changed at the project level, write nothing.

## Iterating on a spec

A spec is a living artifact.

- Add a new requirement at the bottom, with the next `<NS>-REQ-N` number.
- Reprioritize and rewrite a pending requirement freely.
- Mark a completed but irrelevant requirement `obsolete`. Never delete it.
- When the goal itself shifts, rewrite **The problem** or **The solution**. The spec states
  what the work is now, and the statuses carry the history.
- When the spec moves to another stage, set its milestone and its tasks' milestones through
  **milestones**.

After a build lands:

1. **Read** the spec again, because it can have changed.
2. Write `` `done` `` on the requirement's line, and name the pull request there.
3. Check the criteria that are satisfied. **A criterion that asserts something no longer
   happens is checked only when it names the test that proves it.** If one criterion holds
   several claims, split it: check the claim that landed, and carry the rest to a new
   `<NS>-REQ-N`.
4. Strike through a criterion that a later decision overtook, mark it **Superseded**, and
   name the decision that replaced it. Never delete it.
5. Update the priority column and the line under the table.
6. If the work revealed a new requirement, add it. If it invalidated a pending one, mark it
   `cut`.

## What spec does not do

- It writes no file. The output is the spec and its tasks.
- It creates no task before the author approves it.
- It carries no implementation detail. The build decides that.
