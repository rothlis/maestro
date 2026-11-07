---
name: review
description: Review a pull request against the team's own standards — the blueprints that the blueprint map ties to each path, the review's generic method (comment hygiene, guards, security leads), and the spec the branch implements. It reviews the pushed head on the user's own Claude session and `gh` token, posts the review on GitHub, then fixes the findings until the review approves. Use on an open pull request, or whenever asked to "review my changes against our blueprints". A front door onto the `maestro-review` workflow, which holds the passes and fans them out to the review engines. In a session or an agent that cannot run it, this skill says so rather than degrading to a single-context review.
argument-hint: "[pull request number] [effort]"
metadata:
  tags: review,conventions,blueprints,quality
  alwaysApply: "false"
---

# Review

This is `/maestro:maestro review`: a repo-aware review of a **pull request**, at its pushed head. Generic reviewers (the `pr-review-toolkit` agents) only know best practices. They don't load the team's blueprints or its shared memory, and two of them ship with conventions from another codebase. This skill closes that gap: it routes each changed file to the blueprint the map gives it, then hands the work to the generic engines with that checklist injected.

**The review lives in one place: [`workflows/maestro-review.js`](../../../workflows/maestro-review.js).** That script holds the passes, the engine each one uses, and the override every engine needs. This file does not repeat them — a second copy would drift. [`references/method.md`](references/method.md) holds the review's own method: how to cite an authority, the comment measurement, the guards, the security leads, and what not to flag. Every reviewer reads it directly. [`../references/review-risk.md`](../references/review-risk.md) holds the rules that decide whether a person must read the change.

Why a workflow and not this skill's own dispatches: the passes must run in parallel, in separate contexts. A workflow script spawns subagents; an agent cannot. So the fan-out belongs one level up, in the script. A pass starts only when the diff holds files it reviews, and it reads only those files: the bug passes skip documents, each surface pass waits for a file on its surface, and the spec pass waits for a task issue.

## The team's standards

The review reads the team's files from the consumer repository, never from this plugin:

- **`.maestro/config.json`**, optional. `baseBranch` (default `main`) gives the base, `origin/<baseBranch>`. `blueprintMap` (default `.maestro/blueprints/map.json`) names the map.
- **The blueprint map.** Each surface in it has an `id`, a `blueprint`, `paths`, and optionally `reviewRisk`, `reviewTeam` and `designReview`. The review buckets the changed files by surface and runs one checklist pass per touched surface, against that surface's blueprint. A surface that sets `designReview` also gets a design pass, which reads that file as its design guide. A file that no surface matches goes to a conventions pass on the generic method.
- **No map** → the review still runs, on the generic method, the repository's instructions files and the code. The report says that no blueprint was found.

## Before the review starts

Four cases need a decision before anything runs:

- If the current branch has no open pull request and the arguments name none, the review cannot run. Tell the user to push the branch and open a draft pull request, then stop.
- If `git status --porcelain` prints anything, the review cannot read those changes, because it reads only the pushed head. The commit of the fix loop can also sweep them into the push. Ask with `AskUserQuestion` whether to commit and push them first, or to review the pushed head without them. If the user chooses the second option, commit only the files that a fix changes. A run cannot start while the changes are in the working tree, so set them aside with `git stash push -u -m "maestro-review-<pr>"` and restore them by their stash SHA after the post.
- If the arguments name a path or an aspect, tell the user that the review reads the whole pull request and ignores the scope.
- If the arguments name an effort level (`low`, `medium`, `high`, `max`), pass it to `prepare` with `--effort`. The default is `medium`. Pass `max` only when somebody asks for a deeper review, and `low` when somebody asks for a faster one. **The level lowers the passes that find, and the pass that refutes never runs below `high`**, for the reason the script states beside the tiers.

## Step 0 — Decide where the review can run

Check which tools you have, then take the matching branch. Do this before anything else.

**You have the `Workflow` tool** → go to [Run the review](#run-the-review). Invoking this skill is the opt-in that the `Workflow` tool asks for, so no further permission is needed.

**You have `Skill` but neither the `Workflow` tool nor the `Agent` tool** → you are probably nested, in a workflow agent or a subagent, because neither tool nests. Confirm it before you take this branch: a nested agent answers to a caller, not to a user, so it cannot use `AskUserQuestion`. If you can ask the user, take the last branch instead.

When you are nested, **stop. Do not review in one context.** First resolve the paths in scope — `git diff --name-only origin/<baseBranch>...HEAD`, plus `git diff --name-only` and `--staged` — because that is read-only and needs no dispatch. Then return to your caller:

- those paths, as data
- one line: this review needs a fan-out that a nested agent cannot do, so the caller must run `workflow('maestro:maestro-review', { pluginRoot, scope })` one level up

**You have the `Agent` tool but no `Workflow` tool** → dispatch the passes yourself. **Read `${CLAUDE_PLUGIN_ROOT}/workflows/maestro-review.js` and use the prompts, the engine (`agentType`), the `model` and the `effort` of each pass in it**, so this path and the workflow enforce the same thing at the same cost. Fill in the plugin's paths as the script does. Skip the refutation phase, and say in the report that findings are unverified.

**A dispatch was already denied in this conversation, or session instructions forbid these tools** → stop and ask with `AskUserQuestion`. Put the recommended option first and name the cost of each:

- **Allow the review to fan out (recommended)** — what this skill is for.
- **Single-context review instead** — say plainly what it loses: no independent correctness engine, no breadth passes, no refutation, and one context holding the diff, every blueprint and the synthesis at once. Suitable for a handful of files, not a real PR.
- **Cancel** — better than a review that reads more thorough than it was.

If the user picks the single-context option, run it, but label the output **"Maestro Review (single-context — reduced coverage)"** and name every pass you skipped.

## The review reads the checked-out tree, in two phases

The run resolves its scope in one phase, and it reads the files in later ones. Both phases read the tree that is checked out at that moment, and never a captured revision. The run reads the team's authorities the same way: the blueprint map and the blueprints come from the branch you are on. Two rules follow, and the run reports a breach of neither one.

**Rebase on the base branch before you review.** A branch that is behind carries that branch's copy of the rules, so the passes enforce the standard of the day the branch started. Count the gap first:

```bash
git fetch -q origin <baseBranch> && git rev-list --count HEAD..origin/<baseBranch>
```

A branch far enough behind can predate the blueprints altogether. Then the passes are told to read files that are not there, and a report of "0 findings confirmed" reads as a clean diff. The same diff, rebased, can produce real findings. When you must review without a rebase, say in the report which commit the rules came from.

**Hold the tree still until the review returns.** A branch switch between the two phases leaves the passes reading one branch's file list against another branch's contents. Nothing warns, and the report reads exactly as a clean one. The review runs in the background, which is what makes this easy to hit: the natural thing to do while you wait is other work, and other work often means another branch. Note `git rev-parse --short HEAD` before you start, and read it again when the report arrives.

## Run the review

The review runs the `maestro-review` workflow in this session, on the user's tokens, and posts as the user. The pull request then shows a Maestro summary comment, a verdict review, line comments and file comments. Each one carries a hidden marker, so that a later pass reads it as Maestro's output and never as a reply from a person.

**GitHub refuses an approval and a change request from the author of a pull request, so the verdict review only comments.** The verdict is recorded in the summary comment, in a hidden marker that `local.mjs post` writes:

```
<!-- maestro-review: verdict=<approve|changes|comment> head=<sha> -->
```

`<sha>` is the full head that the pass reviewed. Other tools read this marker, `/maestro:maestro announce` among them, so never change its name or its format.

[`scripts/review/local.mjs`](../../../scripts/review/local.mjs) does the GitHub work. Its header states each output and each exit code. Run it from the root of the repository.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/review/local.mjs prepare [<n>] [--effort <level>]`. It checks that the working tree is clean and on the pushed head, reads the earlier passes, and picks the base of a re-check. Then it marks the summary comment as started, so the comment exists before the review and stays at the top of the pull request.
2. If the script exits with code 2, the local branch has commits that the remote does not have. Ask the user whether to push them first. If the user says no, stop, because the fix loop pushes the whole branch and those commits go out with the fixes. If the user says yes, push them, then do step 1 again. If it exits with code 3, the working tree has changes: handle them as [Before the review starts](#before-the-review-starts) says, then do step 1 again. If it exits with code 1, report its last line and stop.
3. Note `head-sha`, `out-dir`, `args` and, for a re-check, `recheck-prompt`. A re-check can move HEAD to a stand-in commit with the same files, so do not commit until step 6 ends.
4. Run `Workflow({ name: "maestro:maestro-review", args: <args> })`, with `args` exactly as printed: they already hold `pluginRoot`, the base, the effort and the re-check inputs. If the tool finds no workflow by that name, run `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/maestro-review.js", args: <args> })`, which needs read access to the plugin's directory. Hold the tree still until it returns, as [the section above](#the-review-reads-the-checked-out-tree-in-two-phases) says. When it returns, write its whole return value as JSON to `<out-dir>/result.json` with the Write tool. If it fails, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/review/local.mjs failed`, which puts the branch back and marks the summary as failed, then report the failure and stop.
5. If `prepare` printed `recheck-prompt`, read that file and do what it says. It judges each earlier finding, and it writes `<out-dir>/recheck.json`.
6. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/review/local.mjs post`. It puts the branch back on the reviewed head, posts the pass, writes the verdict marker, and prints `outcome`, `review-url` and `summary-url`. If it stops on a pending review of the user, tell the user to submit or delete that review, then run `post` again.
7. Read the verdict from `outcome`: `approve` is an approval, `changes` is a change request, and `fixes` or `unsure` is a comment. Then go to [the fix loop](#fix-the-findings).

If the session stops between step 1 and step 6, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/review/local.mjs restore`. It puts the branch back on the head that the pass read.

**Never pass `resumeFromRunId`.** A failed pass has no cached result, so a resume re-runs that pass _and every agent after it_: the whole review again, at full cost. The script already launches a pass that returned nothing a second time. If the run still fails, launch a fresh review.

### A direct call

Outside this route, such as from another workflow, pass the args yourself. `pluginRoot` is required, because a workflow script cannot read files and its agents run in the consumer's repository:

```js
const review = await workflow("maestro:maestro-review", {
  pluginRoot: "${CLAUDE_PLUGIN_ROOT}",
  baseBranch: "main", // from .maestro/config.json
  effort: "medium",
});
```

- **`base`** defaults to `origin/<baseBranch>`, and the scope phase fetches it first. Do not pass a plain local branch: a local base that is behind adds the upstream commits to the diff.
- **`scope`** narrows the review to paths or aspects. **When the arguments name a level, take that word out before you use the rest as `scope`.** A level left inside `scope` narrows the review to a path that does not exist, and the review then reports on nothing.
- `workflow()` nests one level only, so call it from the top-level script.

It returns `{ report, prShape, specCheck, humanReview, blueprintMap, surfaces, findings, confirmedCount, droppedSuggestionCount, refutedCount, unverifiedCount, passes, failedPasses }`.

## Read the result

`report` is already in the house format, grouped by severity, with the authority cited on each finding. When you present it, carry these over rather than trim them:

- **`failedPasses`** — every pass that did not run: it gave no result twice, or it could not open a file it was told to read. Its part of the diff is unreviewed, so never call it a pass that found nothing. A pass that the diff gave nothing to review is not started, and it is not a failed pass: the report names it with its reason. A review is trusted in proportion to what it actually ran.
- **`unverifiedCount`** — findings that no refutation pass checked, because the verifier failed or because they sit past the verification cap. They stay in the report, marked unverified.
- **`blueprintMap`** — `null` means no map was found, so the passes ran on the generic method only. Say so.
- **`prShape`** — the pull request shape verdict, which one pass carries as its one process exception. It is the first section of `report`. It is a verdict and not a finding, so it never appears in a severity group and no refutation pass judged it. A `null` here means the check did not run, and the report says so.
- **`specCheck`** — whether the diff contradicts a requirement it is meant to satisfy, from the `spec` pass. It is a verdict too, reported apart from the findings. **Carry `requirementIds` over even when `contradictions` is empty**, because a check that found nothing and a check that never ran read the same otherwise. `ran: false` means the branch resolved to no `maestro:task` issue, which is normal outside the maestro flow, and `note` says which step of the chain broke.
- **`humanReview`** — whether a person must read the change, from the `Route` phase, against [`review-risk.md`](../references/review-risk.md) and the `reviewRisk` file of each touched surface. It is a decision, and it gates nothing: the author decides when to merge. Each reason names a file, the rule that fired, and its level. The review requests no team itself: the summary marks each team that the map's `reviewTeam` gives a reason, and the author requests it. A `null` here means the check did not run, and the report says so.

If `findings` is empty and `failedPasses` is empty, confirm the diff is clean and name the passes that ran. Silence reads as "not checked".

## Fix the findings

1. Read the summary. The number after `issuecomment-` in `summary-url` is its id: `gh api repos/{owner}/{repo}/issues/comments/<id> --jq .body`. Its first section is the current pass, and it links each open line or file comment.
2. Report the verdict, the teams that the human review names, the findings that are still open, and the link to the summary. Do not copy the whole summary into the conversation. If the verdict is `approve` and no finding is open, stop here.
3. Sort the open findings by the severity label of each comment. A `Blocking` or a `Should fix` finding is required, because it holds the verdict back. A `Suggestion` is optional. The summary gives the label of each open finding, from this pass and from earlier passes. If a label is missing, read the severity of a line or file comment from the `<!-- maestro-finding severity=… -->` marker in the first comment of its thread. For a finding in a file outside the diff, read it from the body-findings marker of the newest verdict review. A finding is already declined when a person replied to it to decline it or to justify it. The `Not fixed` reply of step 8 is one example, and a reply in the words of the user is another. For a line or file comment, read the replies in its thread. For a finding in a file outside the diff, read the pull request comments that name its id. Steps 4 to 6 skip a declined finding, so the loop never overrides a decision of the user. If you cannot tell whether a reply declines the finding, do not fix it in step 4 or step 5. Put it in the question of step 6.
4. Fix each required finding now, without a question. Read the code at the cited line before you fix it. If you think that a required finding is wrong, do not fix it. Put it in the question of step 6, with your reason.
5. Weigh each suggestion before you ask about it. Read the code at the cited line, then decide two things:

   - **Is it worth a fix?** It is worth a fix when its claim is true at the head, and the fix makes the code more correct, safer or clearer. It is not worth a fix when the claim is false. It is not worth a fix when the gain is only a matter of taste, or when the work belongs to another pull request.
   - **Is it quick?** A quick fix is a small edit in a file that the pull request already changes. It changes no behavior and no public contract, and it needs no new file, test or dependency. Every other fix is large.

   Then take one of these actions:

   - If the suggestion is worth a fix and quick, and step 4 fixes at least one required finding, fix it now, without a question. It goes in the same commit and the same re-check that the required fixes already cost.
   - If the suggestion is worth a fix and quick, and step 4 fixes no required finding, put it in the question of step 6, so the user decides. If the verdict is not `approve`, say that its fix alone costs one more push and one more full review run. If the verdict is `approve`, say that its fix costs one push and no review run, because step 9 starts no re-check for it.
   - If the suggestion is worth a fix and large, put it in the question of step 6, and say what the fix changes.
   - If the suggestion is not worth a fix, put it in the question of step 6. Recommend to leave it, and give your reason.

6. Ask one `AskUserQuestion` with `multiSelect` about the findings that are not fixed yet:

   - each suggestion that step 5 did not fix
   - each required finding that you think is wrong
   - each finding whose reply step 3 could not read as a decline

   Give one option for each finding. Its label gives the claim and the location. Its description gives your two decisions from step 5, your recommendation, and the reason for it. Put the findings that you recommend to fix first. A question takes 2 to 4 options, and one call takes up to 4 questions. So for more than 4 findings, put them in several questions, grouped by file. For more than 16 findings, ask again in a second call. For one finding, add a "Leave it" option. Fix the findings that the user selects. If no such finding exists, do not ask. Keep the reason that each option showed, because step 8 writes it in the reply to a finding that is not fixed. If the user gives a reason in a note or in "Other", keep the words of the user instead.

   **A required finding that the user declines needs a reason that answers its argument.** The re-check resolves a declined finding only when its reply gives a reason, states true facts and answers the argument of the finding. A reply with no reason keeps it open, and the next run is spent for nothing. So when the user declines a required finding and no reason that answers its argument is on hand, ask one more `AskUserQuestion` before step 7. Give 2 to 4 reasons that you drafted from the argument of the finding, each one as an option, and say in each description which fact the user must confirm. The user picks one or writes their own in "Other". Never draft a fact that you did not check.

7. Prove the fixes with the proof commands of the blueprint for each file you changed. If a command fails, correct your change before you continue. Then commit the fixes in one commit. Make sure that the pull request is still open (`gh pr view <n> --json state`), then push the branch.
8. Reply to each finding that this pass decided, after the push, so that the commit exists on GitHub. A reply tells a reader of the pull request what happened to the finding, without a read of the diff.

   - For a finding that you fixed, write `Fixed in <short sha>: <what changed, in one sentence>.`
   - For a finding that you did not fix, write `Not fixed: <reason>.` Use the reason that its option showed in step 6, or the words of the user. Never write a reason that the user did not see. A required finding always gets the reason from step 6. Only a suggestion can get `Not fixed: left on purpose, with no reason given.`, when the user declined a fix that you recommended and gave no reason, because a suggestion does not hold the verdict back.
   - For a line or file comment, reply in its thread: `gh api -X POST repos/{owner}/{repo}/pulls/<n>/comments/<id>/replies -f body=<text>`. `<id>` is the first comment of the thread, which the summary links as `#discussion_r<id>`.
   - A finding in a file outside the diff has no thread. Write one comment on the pull request for all of them with `gh pr comment <n> --body <text>`. Start each line with the id of its finding.
   - Reply one time to each decision. If the thread already holds the same decision from an earlier pass, do not reply again.

   This session posts as the user, so the re-check reads each reply as a reply from a person. It judges the reason of a `Not fixed` reply on a required finding as a justification. That is why each reason is one that the user saw or wrote.

9. Start the re-check: go back to step 1 of [Run the review](#run-the-review). Do not ask first, because the request for a review is the request for the whole loop. Start no re-check when both of these are true: step 7 pushed no commit, and no reply on a required finding is new since the last pass. A new reply on a suggestion alone starts no re-check, because a suggestion does not hold the verdict back. A re-check of the same head with no new reply finds the same findings.

   **Start no re-check either when the verdict of this pass is `approve` and step 7 pushed only quick fixes of suggestions**, as step 5 defines a quick fix. A re-check of a minor fix costs a full review run. The commit then has no independent review of its own, so tell the user that the push was not reviewed, and that they can run `/maestro:maestro review` again to review it. The verdict marker still names the older head, which is how a reader can tell. A large fix of a suggestion still starts the re-check, because it can introduce a defect.

10. Stop the loop when the verdict is `approve` and step 9 starts no re-check. Also stop it when the user declined every open finding. A re-check must first judge the reply of step 8 to each one. After the third re-check, ask the user before you start another one, because each run costs a full review.

A required finding that the user declines stays open until a re-check judges its reply. The re-check closes a finding only when the code fixed it, or when a reply from a person justifies it. If the re-check keeps the finding open, tell the user that the review does not approve the pull request while that finding is open. They can reply in the thread of the finding with a stronger reason. For a finding in a file outside the diff, they reply in a comment on the pull request that names its id. Then they run `/maestro:maestro review` again, and the re-check judges the reply.

## Notes

- **Never report a reduced pass as a full one.** If any pass was skipped, failed, or was narrowed by the arguments, say which, in the report itself.
- The blueprints are the one place the team's rules live; `references/method.md` holds the review's own method; `workflows/maestro-review.js` is the one place the passes live. If a rule changes, edit the blueprint that owns it. If a pass changes, edit the script. Never restate either here.
- **A finding says two things.** The code is wrong, and nothing in the blueprints stopped it. A finding that cites no rule names a blank space on the map. When one keeps coming back, offer the user to add the rule to the blueprint of its surface.
- The correctness and error-handling passes use the `pr-review-toolkit` agents when that plugin is installed. Without it, the script runs the same prompt on the default agent, so the pass still runs with less depth.
- `code-simplifier` is deliberately absent from the passes: its baked-in rules (function-over-arrow, avoid-try-catch) contradict many codebases. If a `/simplify` skill is installed, use it when a simplification pass is wanted.
