---
name: setup
description: Set Maestro up in a repository, once, and again whenever the team wants to change a value. Asks one question at a time about the method, the store, the memory directory, the base branch, the branch pattern, the blueprint map, the Slack channel and the board, with the current values as the defaults. Then writes the full .maestro/config.json, creates the memory directory and its index, offers the CLAUDE.md pointer, and makes the store ready. Commits nothing.
argument-hint: ""
---

# Setup

Set Maestro up in this repository. Run it once per repository. Run it again to change a value:
it reads the current configuration and offers each value as the default.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where `<store>` is config `store` (default `github`).

**Setup writes the full `.maestro/config.json`, with every value, defaults too.** A team that
reads the file then sees each choice, and does not have to know the defaults.

## Workflow

### 1. Read what exists

If `.maestro/config.json` exists, read it. Each value in it is the default for its question
below. Else the defaults are the ones in the Configuration table in [../SKILL.md](../SKILL.md).

### 2. Ask, one question at a time

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
3. **Memory directory.** `.maestro/memory` (Recommended), or another path.
4. **Base branch.** Read it from git, and offer it first:

   ```bash
   git symbolic-ref refs/remotes/origin/HEAD --short | sed 's#^origin/##'
   ```

   If the command fails, offer `main`.
5. **Branch pattern.** None (plain kebab-case), `<type>/<slug>`, `sprint-<n>/<slug>`, or
   another pattern in "Other".
6. **Blueprint map.** `.maestro/blueprints/map.json`, or another path. If no map is at that
   path, offer to copy the examples from `${CLAUDE_PLUGIN_ROOT}/templates/.maestro/blueprints/`.
   **Never overwrite a file that exists.** Copy only the files that are missing.
7. **Slack channel for `announce`.** A channel name, or **Skip**. With Skip, `announce` asks
   for a channel each time.
8. **Board instructions for `sync`.** Free text that says how `sync` reaches the board, or
   **Skip**. With Skip, `sync` writes the progress into the project only.

### 3. Write the configuration

Write `.maestro/config.json` with every value from step 2. Keep any key that the file held
and that no question covers, such as `prShape`. Omit `announce` or `board` only when the user
chose Skip and the file did not hold one.

Show the file to the user after you write it.

### 4. Create the memory directory

If `<memoryDir>/MEMORY.md` does not exist, create the directory, and copy the empty index from
`${CLAUDE_PLUGIN_ROOT}/templates/.maestro/memory/MEMORY.md`. Never overwrite an index that
exists. The format is in [../memory.md](../memory.md).

### 5. Offer the CLAUDE.md pointer

The index loads into every session only through a line in the repository's `CLAUDE.md`. If
`CLAUDE.md` does not hold the line already, show the line and ask whether to add it:

```markdown
@<memoryDir>/MEMORY.md
```

Use the real path. Add the line only after the user agrees. [../memory.md](../memory.md)
gives the short section to put around it.

### 6. Make the store ready

Do the store operation **ready**. On GitHub it creates the missing labels. On a tracker it confirms the mapping.
If **ready** stops, say why, and report what the earlier steps wrote.

### 7. Report

List each file that setup wrote or changed, and each label or tracker check it did. Then
offer to commit the files, and name the next mode: `/maestro:maestro init` to open a project.

## What setup does not do

- It commits nothing. It offers.
- It overwrites no blueprint and no memory index that exists.
- It creates no project. `/maestro:maestro init` does that, once per project.
