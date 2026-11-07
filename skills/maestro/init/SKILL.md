---
name: init
description: Create the pitch issue — the root of a pitch's GitHub issue tree. Creates any missing maestro label, labels the issue maestro:pitch and writes a fixed body: fields that point at the shaped pitch and, when one exists, at the pitch on the team's board, the names of the scopes, and an empty progress section that sync owns. Writes .maestro/config.json only when the team wants a value that is not the default.
argument-hint: "[optional pitch name in kebab-case]"
---

# Pitch issue

The pitch issue is the root of the tree. Research and spec issues hang off it, task issues
hang off a spec, and a pull request closes one or more tasks. The tree, the four labels and
the sub-issues trap are in [../SKILL.md](../SKILL.md).

**A pitch issue is a pointer and not a document.** The argument lives in the shaped pitch,
in whatever tool the team shapes in. The work lives in the sub-issues. The body holds a fixed
set of fields, the scope names and the progress section, and nothing else, so that every
pitch issue looks the same.

## Workflow

### 1. Create the missing labels

```bash
gh label list --search "maestro:" --json name --jq '.[].name'
```

Create each of the four labels that the list does not show, and only those:

```bash
gh label create maestro:pitch    --color 5319E7 --description "Maestro: the root of a pitch"
gh label create maestro:research --color 0E8A16 --description "Maestro: a research issue"
gh label create maestro:spec     --color 1D76DB --description "Maestro: a spec issue"
gh label create maestro:task     --color FBCA04 --description "Maestro: a task a pull request closes"
```

`--force` overwrites the color and the description of a label that exists. Do not add it to
a label the team already has, because the team can have chosen its own color.

### 2. Settle the configuration

If `.maestro/config.json` exists, read it and go on.

If it does not exist, show the user the defaults from the Configuration table in
[../SKILL.md](../SKILL.md), and ask whether any of them differs for this repository. **Write
the file only when a value differs**, and write only the fields that differ. A repository on
every default needs no file.

### 3. Get the pitch name

Read the name from the argument. If no argument exists, read it from the branch name, against
`cycle.branchPattern`. If neither gives a name, ask the user with `AskUserQuestion`.

The name is kebab-case, such as `bulk-invoice-export`. The issue title is
`Pitch: <Pitch Name>`, in title case.

### 4. Look for an existing pitch issue

Run this before you create anything:

```bash
gh issue list --label maestro:pitch --state all --search "<pitch name>" --json number,title,state
```

If a pitch issue for this name exists, report its number and stop. Two pitch issues for one
pitch split the tree, and no query can join them again.

### 5. Get the links

- **Shape.** The shaped pitch that holds the argument: a doc page, a markdown file, an issue,
  wherever the team shapes. Ask the user for the link. A pitch always has a shape, so do not
  create the issue without it.
- **Board.** The pitch on the team's board, when `board.instructions` in the configuration
  says how to reach one. Follow those instructions to find it. If the board holds no pitch
  with this name, or no board is configured, omit the `**Board**` line. Do not create a board
  item here, because `/maestro:maestro sync` owns that.

### 6. Get the scope names

The scopes come from shaping. Read their names from the shaped pitch, or ask the user. Write
the names only: a scope's description stays in the shape. A pitch can have no scopes yet.
Then the list stays empty, and `/maestro:maestro sync` uses one scope named for the pitch.

### 7. Create the issue

The body is exactly this, and nothing else:

```markdown
**Pitch**: <Pitch Name>
**Shape**: [<title>](<link to the shaped pitch>)
**Board**: [<title>](<link to the pitch on the board>)

## Scopes

- <scope name>
- <scope name>

<!-- maestro:progress:start -->
<!-- maestro:progress:end -->
```

Omit the `**Board**` line when no board item exists. Keep the `## Scopes` heading when the
list is empty. Leave the progress section empty: `/maestro:maestro sync` owns the text
between the two markers and rewrites it. Add no other field, no other heading and no
summary.

```bash
gh issue create --title "Pitch: <Pitch Name>" --label maestro:pitch --body-file <path>
```

Write the body with a file and the `--body-file` flag. A here-string loses the line returns,
and the fields then render as one line. Then read the body back, as
[../SKILL.md](../SKILL.md) says under Writing an issue body.

### 8. Report

Give the user the issue number and its URL. Then name the next mode:
`/maestro:maestro research` to explore, or `/maestro:maestro spec` to write the requirements.

## What init does not do

- It writes no file other than `.maestro/config.json`, and that one only when a value
  differs from the default.
- It creates no board item. `/maestro:maestro sync` writes to the board.
- It writes no progress. The progress section starts empty, and sync fills it.
- It writes no summary of the pitch, and no description of a scope, into the body. The
  shape holds the argument.
