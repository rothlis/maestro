---
name: setup
description: Set Maestro up in a repository, once, and again whenever somebody wants to change a value. First asks whether the whole team uses Maestro here (the config goes in the repository's .maestro/) or only the user (it goes in ~/.maestro/<owner>/<repo>/, and nothing is written to the repository). Then asks one question at a time about the method, the store, the memory directory, the base branch, the branch pattern, the blueprint map, the chat channel and the board, with the current values as the defaults. Then writes the full config, creates the memory directory and its index, offers the CLAUDE.md pointer for a team setup, and makes the store ready. Commits nothing.
argument-hint: ""
---

# Setup

Set Maestro up in this repository. Run it once per repository. Run it again to change a value:
it reads the current configuration and offers each value as the default.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where `<store>` is config `store` (default `github`).

**Setup writes the full config, with every value, defaults too.** A reader of the file then
sees each choice, and does not have to know the defaults.

## Workflow

### 1. Read what exists

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs`. It prints the current values, the
`scope` (`team`, `me` or `none`), the `configPath`, and `privateDir`, the folder that holds
a private setup of this repository. Each current value is the default for its question below.
Without a config, the defaults are the ones in the Configuration table in
[../SKILL.md](../SKILL.md).

### 2. Ask who uses Maestro here

Ask this first, with `AskUserQuestion`. Skip it when `scope` is already `team` or `me`, and
keep that scope.

- **The whole team (Recommended).** The config, the memory and the blueprints go in
  `.maestro/` at the root of the repository, and the team commits them. Everybody shares
  what one person learns, and the review uses the same standards for everybody.
- **Only me.** Everything goes in `privateDir`, `~/.maestro/<owner>/<repo>/`. Nothing is
  written to the repository. Use it when you cannot commit to the repository, or do not want
  Maestro to be visible in it. The memory and the blueprints are yours alone, unless you
  point them at a folder that you share with your team (question 3 and question 6).

If the answer is **Only me** and `privateDir` is `null`, the repository has no `origin` remote
to name the folder by. Say so, and stop.

If the scope is `team` and the user asks for a private setup, say that the team's
`.maestro/config.json` wins over a private one, so a private config would be ignored. Offer to
change the team's values instead.

### 3. Ask, one question at a time

Ask each question with its own `AskUserQuestion` call, in this order. Put the recommended
option first, and mark it "(Recommended)". When the file holds a value, that value is the
recommended option. Wait for each answer before you ask the next question, because an answer
can change the question after it.

1. **Method.** `default`, or `shape-up`.
2. **Store.** `github`, or `tracker`. If the answer is `tracker`:
   - Ask for the mapping, as one paragraph of free text: which MCP, and how each artifact
     maps. Show the example in [../references/stores/tracker.md](../references/stores/tracker.md).
   - Search with `ToolSearch` for the tracker's name, and make sure that its MCP tools exist.
     If none comes back, say that the MCP is not connected. Ask whether to keep `tracker` or
     go back to `github`.
3. **Memory directory.** For the team: `.maestro/memory` (Recommended), or another path in
   the repository. For only me: `memory` (Recommended), which is `<privateDir>/memory`, or
   a folder that you share with your team, such as `~/acme-maestro/memory` in a clone of a
   separate repository. A relative path is relative to the repository for the team, and to
   `privateDir` for only me. `~` is the home folder.
4. **Base branch.** Read it from git, and offer it first:

   ```bash
   git symbolic-ref refs/remotes/origin/HEAD --short | sed 's#^origin/##'
   ```

   If the command fails, offer `main`.
5. **Branch pattern.** None (plain kebab-case), `<type>/<slug>`, `sprint-<n>/<slug>`, or
   another pattern in "Other".
6. **Blueprint map.** For the team: `.maestro/blueprints/map.json`. For only me:
   `blueprints/map.json`, or a map in the shared folder of question 3. Or another path. If no
   map is at that path, offer to copy the examples from
   `${CLAUDE_PLUGIN_ROOT}/templates/.maestro/blueprints/` into the map's folder. The paths in
   a map are relative to the map's own folder, so the copies work wherever they land.
   **Never overwrite a file that exists.** Copy only the files that are missing.
7. **Chat for `announce`.** `slack`, `teams` (Microsoft Teams), or **Skip**. With Skip,
   `announce` asks for the chat and the channel each time. Else ask for the channel: a name
   such as `#pull-requests` for Slack, or `<team> / <channel>` for Teams. Write both to
   `announce.chat` and `announce.channel`.
8. **Board instructions for `sync`.** Free text that says how `sync` reaches the board, or
   **Skip**. With Skip, `sync` writes the progress into the project only.

### 4. Write the configuration

Write the config with every value from step 3: `.maestro/config.json` for the team, and
`<privateDir>/config.json` for only me. Keep any key that the file held
and that no question covers, such as `prShape`. Omit `announce` or `board` only when the user
chose Skip and the file did not hold one.

Show the file to the user after you write it.

### 5. Create the memory directory

If `<memoryDir>/MEMORY.md` does not exist, create the directory, and copy the empty index from
`${CLAUDE_PLUGIN_ROOT}/templates/.maestro/memory/MEMORY.md`. Never overwrite an index that
exists. The format is in [../memory.md](../memory.md).

### 6. Offer the CLAUDE.md pointer, for the team only

**Skip this step for only me.** The repository's `CLAUDE.md` is part of the repository. Every
mode reads the memory index when it starts, so a private memory still loads when Maestro runs.
It does not load in a session that runs no Maestro mode.

For the team, the index loads into every session only through a line in the repository's `CLAUDE.md`. If
`CLAUDE.md` does not hold the line already, show the line and ask whether to add it:

```markdown
@<memoryDir>/MEMORY.md
```

Use the real path. Add the line only after the user agrees. [../memory.md](../memory.md)
gives the short section to put around it.

### 7. Make the store ready

Do the store operation **ready**. On GitHub it creates the missing labels. On a tracker it confirms the mapping.
Labels live in the repository, so other people see them even with a private setup. If the
user has no right to create a label, **ready** stops: say so, and offer `tracker` or a
maintainer who creates the labels.
If **ready** stops, say why, and report what the earlier steps wrote.

### 8. Report

List each file that setup wrote or changed, and each label or tracker check it did. For the
team, offer to commit the files. For only me, say that nothing was written to the repository.
Then name the next mode: `/maestro:maestro init` to open a project.

## What setup does not do

- It commits nothing. It offers, for a team setup.
- It overwrites no blueprint and no memory index that exists.
- It creates no project. `/maestro:maestro init` does that, once per project.
