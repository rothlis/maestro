---
name: research
description: Explore a topic across five sources in parallel — shared memory, the codebase, prior art, the team's own docs, and the team's chat — then grill the findings and write a research artifact under the project, in the store. The output is an artifact, never a file.
argument-hint: "[optional topic, or the reference of a research artifact to iterate on]"
---

# Research

Research finds out what is already true before anybody decides what to build. It reads five
sources at the same time, grills the findings afterwards, and writes one research artifact under
the project.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where `<store>` is config `store` (default `github`).

**Two orderings are load-bearing.** The five sources run in parallel, because each one
answers a different question and none waits on another. The grilling runs last, because a
question asked first narrows the search before the search happens.

Use ultrathink for maximum reasoning depth.

## Workflow

### 1. Find the project

**Find projects**, and pick the one with this name.

If no project exists, offer to run `/maestro:maestro init` first. The research is a child of
the project, so the project must exist before this mode writes anything.

If the argument is the reference of a research artifact, **read** it. This is iteration mode:
ask the user what to add or revise, then run the sources that the change needs.

### 2. Get the topic

Read the topic from the argument, or ask the user for it. A topic is one question, such as
"how does the sync worker retry a failed job". A project holds several research
artifacts, one per topic.

### 3. Read the blueprints first

Read the blueprint that the blueprint map (`blueprintMap`) ties to every path the topic
covers. A blueprint states the pattern the code follows, so you then read the code against a
known standard instead of one you infer from what you find. Where the code and the blueprint
disagree, that gap is a finding. With no map, say that no blueprints were found, and go on.

### 4. Run the five sources in parallel

Fire one sub-agent per source, all in one message, so they run at the same time. Each
sub-agent starts with its own context and inherits nothing you have read, so name the
blueprint and the topic in every prompt.

| Source               | What it answers                                                                     | How to reach it                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Shared memory**    | What the team already settled, so nothing is re-derived                             | `<memoryDir>/MEMORY.md`, then every fact whose hook looks relevant                                    |
| **The codebase**     | How it works today, and what must change                                            | Codebase exploration sub-agents, such as `Explore`. Never a manual chain of Grep and Read              |
| **Prior art**        | What already does the job, inside this repository and outside it, on the web       | Step 5 below                                                                                          |
| **The team's docs**  | What the team wrote about this before: docs, RFCs, earlier projects, research, specs and tasks | Any connected doc MCP, the repository's docs, and **find projects**, then the research **children** of each |
| **The team's chat**  | What people said about this, and what they decided in a thread that reached no doc  | The Slack or Microsoft Teams MCP, or another chat MCP. Read any channel you can reach                                    |

**A source with no tool is skipped, and the research says so.** When no doc MCP or chat MCP is
connected, the sub-agent for it does not run, and the **Detail** section names the source
that was not read. A silent gap reads as "nothing found".

**Every chat finding names the message it came from.** Give the permalink. A finding with no
message behind it cannot be checked, and a reader cannot tell a decision from an opinion.

Load the doc and chat MCP tools with `ToolSearch` before you call them. They are often
deferred.

### 5. Survey what already does the job

**Before you propose building anything, name what already exists.** This holds in every
domain (backend, data, infrastructure, agents, frontend), and not only for UI components.
Look in two places:

1. **This repository.** The dependencies in every manifest (`package.json`,
   `pyproject.toml`, `go.mod`, and the like), the tools that the CI configuration already
   runs, and the repository's scripts. A tool that is installed and already runs in CI costs
   almost nothing to adopt.
2. **Outside it.** The packages the ecosystem uses for this job. Read what the nearest one
   or two do.

Give each candidate a verdict: it does the job, it does the job with work, or it does not
and here is why. **Run the nearest candidate against a real case in this tree before you
rank it.** A five-minute probe settles what an argument cannot. A custom import scanner was
once researched, planned and built while `dependency-cruiser` was already a devDependency and
already ran in CI.

### 6. Read the key files

The five sources map the landscape. Now read the specific files for the exact detail: type
definitions, business logic, API routes and handlers, UI components and state, configuration,
agent instructions and tool wiring. Quote the excerpts that make the architecture clear.

### 7. Grill the findings

Grill the findings, and never before them. If a grilling skill is installed (for example
`/grill-me`), use it, else grill inline. The grilling attacks what the five sources returned:
the assumption nothing proved, the conclusion one source carries alone, the alternative
nobody priced. What survives the grilling goes in the research. What does not survive becomes an
open question.

### 8. Write the research artifact

**Create** a research artifact under the project, with the title `Research: <Topic>` and the
body below. Then read the body back, as [../SKILL.md](../SKILL.md) says under Writing a body.

#### The body

```markdown
**Date**: <YYYY-MM-DD>
**Project**: <project ref>

> One line. The question this research answers.

## What we found

The answer to the question, in the words of a person who now knows it. Three to six
paragraphs. Name the branch and the commit the codebase was read at, and the date.

## What already does the job

| Candidate | Where it is | Verdict | The probe |
| --------- | ----------- | ------- | --------- |

One row per candidate, inside this repository and outside it. Required when the direction
builds something custom.

## What must change

| Action     | Path | What |
| ---------- | ---- | ---- |
| **Create** | ...  | ...  |
| **Modify** | ...  | ...  |

## Open questions

- [ ] **<The question>.** Who answers it, and what it blocks.

## Detail

<details>
<summary>How it works today</summary>

The architecture, the data flows, the types and the key files, with excerpts. Everything the
five sources returned that a reader needs only when building.

</details>

<details>
<summary>What the chat says</summary>

One bullet per finding, each with the permalink of the message it came from. Or one line
that says no chat tool was connected.

</details>
```

### 9. Resolve the open questions

Walk the user through every open question before you finish. For each one: discuss it,
explore the codebase if that resolves it, then either resolve it or mark it **deferred**
with a reason. **Replace body** of the research as each one is settled.

A deferred question is acceptable, because the team then chose to go on with the uncertainty.
An unaddressed one is not.

### 10. Keep the project context current

Read the project again, then apply "The project context" in [../SKILL.md](../SKILL.md). Most
research changes **Open questions**: strike the ones it answered and add the ones it found. If
it shows that the problem, the outcome, a decision or a limit is not what Context says, update
it, and ask first for a decision or a limit. Write one line in Changes that names this
research. If nothing changed, write nothing.

## What research does not do

- It writes no file. The output is the research artifact.
- It writes no requirement. `/maestro:maestro spec` owns those.
- It never grills before it explores. The exploration always comes first.
