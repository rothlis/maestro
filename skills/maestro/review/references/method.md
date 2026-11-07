# The review's method

What `/maestro:maestro review` checks on every surface, and how a pass cites what it finds.
Every pass reads this file.

## Authorities

**The team's blueprints are the authorities.** The blueprint map ties paths to blueprints.
`.maestro/config.json` names the map in its `blueprintMap` field, and the default is
`.maestro/blueprints/map.json`. The review gives each surface that the diff touches its own
pass, and that pass reads the surface's blueprint. A rule about one surface lives in that
surface's blueprint, and this file does not restate it. Cite the blueprint rule in the
finding.

After the blueprints come the repository's own instructions files: `CLAUDE.md`, `AGENTS.md`
and `CONTRIBUTING.md`, when they exist. Cite them for what no blueprint owns, such as the
git workflow or formatting.

The **actual code** is the last authority. When a blueprint rule and the code disagree,
say so in the finding. The blueprint states what the team wants, so the code is usually
what is wrong. But a rule that no code follows is a defect in the blueprint, and it
belongs to that blueprint's owner.

**With no map, the review still runs**, on this method, the instructions files and the
code. The report says that no blueprint was found, so nobody reads a generic review as a
review against the team's standard.

The team's shared memory (the `memoryDir` of `.maestro/config.json`, `docs/memory` by
default) is **not** an authority. Its facts help a pass remember traps the team hit, but
a fact can be stale or bound to one context. Treat it only as a **lead to check**: verify
it against the current code before you raise it, and never cite a memory fact as a rule
on its own.

**How to cite.** Each finding names one authority: a blueprint and its rule number or
section, an instructions file and its section, a section of this file, or the code itself
as `path:line`. A finding with no authority and no concrete evidence is an opinion, so do
not report it. The refutation pass opens the authority you cite. A misquoted rule refutes
the finding.

## Comments (all code)

The default is **no comment**: the code is the source of truth, and a comment is one reader's interpretation of it at one moment. Review every comment **added or modified** in the diff, and every comment of a changed file whose subject the diff changed or deleted. Flag the ones that don't earn their place, and the ones that stopped being true. This is the check most likely to have real findings on an AI-authored diff — model-written code tends to leave its own reasoning behind as comments.

Flag for removal (or for trimming to the useful sentence):

- Restates the code below it, or repeats what a name already says — `// Fetch the user` above `fetchUser()`.
- Narrates the change or the author's reasoning rather than the code's behaviour — `// Now we also handle X`, `// Changed to use the port`, `// Note: this is safe because…` where it plainly is. That belongs in the commit message or PR description.
- Section banners (`// ---- Helpers ----`), commented-out code, `TODO`/`FIXME` with no link and no owner.
- Explains the language or the framework (what `??` does, what `useMemo` is for).
- Says something the code should say instead — if a comment is needed to follow the logic, the finding is usually "rename / extract / split", not "reword the comment".
- Retells the story it also points at — a doc comment that recounts a defect and then links the memory fact that holds the same account, or one decision written out on a helper, on its call site and in its test. The pointer replaces the story. Ask for the one sentence that names the constraint, plus the pointer.

Keep (and don't ask for more of): the **why** behind a non-obvious choice, a constraint coming from outside the file (external API quirk, race, fragile invariant), a workaround **with a link**, and a doc comment on an exported symbol whose contract isn't evident from the signature. A workaround comment with no link is a finding — ask for the link, not for deletion.

**Ask two questions of each comment, and not one.** Does it earn its place, and is it still true of the code under it after this diff? A comment written against a wider version of the change passes the first question: it states a why, it names a constraint from outside the file, and it reads as the most earned comment there. Only the second question reaches it. A `@link` to a caller the diff deleted is the plain case. A guarantee about two callers, on a diff that narrowed to one, is the quiet one.

**Measure, do not eyeball.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/comment-sweep/ratio.mjs <base> -- <paths>`, which counts the comment lines and the code lines the diff adds, then report the ratio. A workflow pass gets the same command with the plugin's path already filled in. Count non-blank lines only. A line is a comment when it starts with `//`, or when it sits inside a `/* */` block (JSDoc included). The ratio is comment / (comment + code), and test files stay out of the count. Call out a diff above roughly one third comments. Call out any new file whose comment lines outnumber its code lines.

**Local density is not a defence.** "The surrounding file already does this" is the argument that lets a module drift, one file at a time, to more comment lines than code lines. Reject it.

Single-context mode is the weakest place for this check. One context holds the diff, the conventions and the verification, so dense comments read as normal. Measure the ratio. Do not trust the reading.

**Do not raise the inverse finding.** Missing comments are not a finding here unless the code is genuinely unfollowable, and then the fix is the code. Never ask for a comment to be added "for the least experienced future maintainer", never ask for docstring coverage, and never treat an uncommented function as incomplete — `comment-analyzer`'s completeness criteria push that way, and they are wrong for a codebase that wants fewer comments.

A team whose blueprint asks for more comments than this overrides this section. Cite the blueprint.

## Guards

A guard is a test or a script that reads the tree and passes when it finds no fault: a
scanner, a list of files, or a comparison of two lists in the real tree. A guard that reads
nothing also finds nothing, so a green run over the real tree proves nothing about the
guard. A scanner that reads no file, a file list that names 3 of 9, and a type that no call
site consults each report nothing wrong.

Report a guard that the diff adds or changes when no test gives it one case it must reject,
on input that the test owns. The fix is that case, and the author watches it fail once
before the guard ships.

## Design

These lessons hold on any surface. A design pass reads them beside its surface's design
guide, and a surface pass uses them when its blueprint is silent. They are leads, not rules:
a finding from one alone is a suggestion, and it cites this section.

- **The nearest code is not always the precedent.** A read that gets a repository because
  the reads near it have one copies drift. A precedent is code that follows the blueprint.
- **A helper exported only for its test** proves the helper, and not that its caller uses it
  with the right parameters. Test through the contract that the callers use.
- **A generic name can hide one provider.** A port or a file that names no provider, and
  queries the fields of one vendor, misleads the next reader.
- **An expected error thrown through an interface** is not part of the interface's contract,
  so the caller assumes every implementation throws it. Return the error mode in the result
  type instead.
- **A result type that says the opposite of what happened**, such as a success that wraps a
  failure, or "no changes" after a write.
- **A new interface next to one for the same concept.** Ask whether the existing one should
  host the new function.
- **One name that carries two concepts.** A flag that decides two different things must be
  split into two names.
- **A test that asserts the text of a prompt or a content file** tests the copy, and not the
  behaviour.

## Security review focus — leads to verify

These are **reminders, not rules**: things worth checking when the diff touches auth, access control or data scoping. Confirm each against the current code before raising it. Read the team's shared memory too, for leads of its own.

- **A filter that fails open.** In many query builders and ORMs, an `undefined` field in a `where` clause matches every row. A scoping condition must fail **closed**. A typed `userId: string` does not guarantee a value at runtime, for example from a token claim.
- **Authorization on the wrong subject.** A helper that sets or changes an entity's subject type before the check can make an instance check pass against the wrong type. Authorize the real, typed instance.
- **A hidden menu item is not a guard.** Filtering navigation by ability is cosmetic. A page or a route needs its own guard, because a direct URL skips the menu.
- **One gate per resource.** Two code paths that decide visibility for the same resource drift apart. A listing for users and a listing for admins must both go through the same gate.
- **A handler that resolves its dependencies from a root container** that holds full rights skips the caller's role. Resolve them from the container of the request.

## What NOT to flag

- **Process, with one exception.** The pull request shape check is the exception, and one pass carries it, as a verdict rather than a finding: correctness, or the first other pass when the diff changes only documents. No other pass reports on shape, and no pass reports on any other process question.
- Anything a linter/typechecker/formatter/CI catches (imports, type errors, formatting, broken tests) — assumed run separately.
- Pre-existing issues on unmodified lines. Two exceptions, because the diff created each one. A comment that this diff made false is a finding, even on a line the diff never touched. An older fallback that a new fault of this diff now reaches is a finding too, such as a new timeout that ends in an old `.catch(() => [])`.
- Generic nitpicks a senior engineer wouldn't raise, unless a blueprint rule or an instructions-file rule calls it out explicitly.
- **Missing** comments or docstrings (see [Comments](#comments-all-code)).
- Rules that the review engines bring from other codebases: **function-over-arrow, avoid-try-catch, ES-import-sorting, `errorIds.ts`/Sentry/Statsig** (these come from the `code-simplifier` and `silent-failure-hunter` defaults). Raise one only when a blueprint or the code of this repository already follows it.
