#!/usr/bin/env node
/**
 * Runs the GitHub side of a `/maestro:maestro review` pass on a pull request, around the
 * `maestro-review` workflow that the session runs itself. The review skill says what a
 * session does with each output.
 *
 *   node scripts/review/local.mjs prepare [<pull request>] [--effort <level>]
 *   node scripts/review/local.mjs post
 *   node scripts/review/local.mjs failed
 *   node scripts/review/local.mjs restore
 *
 * `prepare` reads the earlier passes and picks the base of a re-check. It then marks the
 * summary comment as started, so the comment exists before the review and stays at the top
 * of the pull request. It prints `pass`, `head-sha`, `base` (the base branch of the pull
 * request, `origin/<branch>`), `plugin-root`, `out-dir`, `args` (the workflow args, as JSON,
 * with `blueprintMap`, `store` and `tracker.instructions` from the config) and, for a re-check, `recheck-prompt` (a file that says how to judge the earlier findings).
 *
 * `post` posts the pass as the person who runs it, and prints `outcome`, `review-url` and
 * `summary-url`. A pass only comments: GitHub refuses an approval from the author.
 *
 * `failed` marks the summary as failed, for a workflow that did not return.
 *
 * A re-check base can move HEAD to a stand-in commit with the same files. `post`, `failed`
 * and `restore` put the branch back on the head that the pass read.
 *
 * The files sit in `.maestro-review/` at the root of the worktree. The directory holds a
 * `.gitignore` that ignores it whole, because the review lists every other untracked file
 * as a change, and the repository's own `.gitignore` need not name it.
 *
 * Exit 0: done. Exit 2: the branch has commits that the remote does not. Exit 3: the working
 * tree has changes, which the review would read and the pull request does not hold. Exit 1:
 * any other stop, with the reason.
 */

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { DEFAULTS, readConfig } from "../config.mjs"
import { isLogin } from "./author.mjs"
import { markSummary } from "./mark.mjs"
import { postPass } from "./post.mjs"
import { gh, ghJson, git, say, stop } from "./shell.mjs"
import { readState } from "./state.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))

/** The install path of the plugin. The workflow runs in the consumer's repository, and reads its own files from here. */
export const PLUGIN_ROOT = resolve(HERE, "../..")

const EFFORTS = new Set(["low", "medium", "high", "max"])

const OUT_DIR_NAME = ".maestro-review"

function outDir() {
  const root = git(["rev-parse", "--show-toplevel"])
  if (!root.ok) stop(`cannot find the root of the worktree: ${root.text}`)
  return join(root.text, OUT_DIR_NAME)
}

/** A `.gitignore` of `*` ignores the directory and itself, so no status lists it. */
function freshOutDir() {
  const out = outDir()
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, ".gitignore"), "*\n")
  return out
}

export function readArgs(argv) {
  let pr = null
  let effort = "medium"
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--effort") {
      effort = argv[++index]
      if (!EFFORTS.has(effort))
        stop(`the effort is ${effort}, and it must be low, medium, high or max`)
    } else if (/^\d+$/.test(argv[index])) pr = argv[index]
    else stop(`unknown argument ${argv[index]}`)
  }
  return { pr, effort }
}

/** The args of the workflow. A re-check narrows `base` and adds its own keys later. */
export function workflowArgs({
  prBase,
  effort,
  config = DEFAULTS,
  pluginRoot = PLUGIN_ROOT,
}) {
  return {
    base: prBase,
    prBase,
    effort,
    route: true,
    pluginRoot,
    blueprintMap: config.blueprintMap,
    store: config.store,
    trackerInstructions: config.tracker?.instructions ?? "",
  }
}

function readPullRequest(arg) {
  const args = [
    "pr",
    "view",
    "--json",
    "number,state,headRefName,headRefOid,baseRefName,isCrossRepository",
  ]
  if (arg) args.splice(2, 0, arg)
  const result = ghJson(args)
  if (!result.ok) stop(`cannot read the pull request: ${result.text}`)
  return result.data
}

/** The review reads the working tree, so it must hold exactly the pushed head. */
function checkTree(pr) {
  if (pr.state !== "OPEN")
    stop(`pull request #${pr.number} is ${pr.state.toLowerCase()}, not open`)
  if (pr.isCrossRepository) stop(`pull request #${pr.number} comes from a fork`)
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"])
  if (!branch.ok) stop(`cannot read the local branch: ${branch.text}`)
  if (branch.text !== pr.headRefName) {
    stop(
      `the local branch is ${branch.text}, but pull request #${pr.number} has the head branch ${pr.headRefName}`,
    )
  }
  const status = git(["status", "--porcelain"])
  if (!status.ok) stop(`cannot read the working tree: ${status.text}`)
  if (status.text) {
    stop(
      "the working tree has changes that the pull request does not hold. Commit and push them, or set them aside, then run this again",
      3,
    )
  }
  const fetched = git(["fetch", "-q", "origin", pr.headRefName, pr.baseRefName])
  if (!fetched.ok) stop(`cannot fetch from origin: ${fetched.text}`)
  const ahead = git(["rev-list", "--count", `origin/${pr.headRefName}..HEAD`])
  if (!ahead.ok) stop(`cannot compare with origin: ${ahead.text}`)
  if (Number(ahead.text) > 0) {
    stop(
      `${ahead.text} local commit(s) are not pushed. The pass reviews the pushed head. Ask the user whether to push them, then run this again`,
      2,
    )
  }
  const head = git(["rev-parse", "HEAD"])
  if (head.text !== pr.headRefOid) {
    stop(
      `the local branch is at ${head.text.slice(0, 10)}, and the pull request is at ${pr.headRefOid.slice(0, 10)}. Pull the branch, then run this again`,
    )
  }
}

/** The GitHub calls of the review read GH_TOKEN, so it takes the token of `gh` when unset. */
function useGhToken() {
  if (process.env.GH_TOKEN) return
  const token = gh(["auth", "token"])
  if (!token.ok) stop(`cannot read the GitHub token of gh: ${token.text}`)
  process.env.GH_TOKEN = token.text.trim()
}

function repository() {
  const repo = ghJson(["repo", "view", "--json", "nameWithOwner"])
  if (!repo.ok) stop(`cannot read the repository: ${repo.text}`)
  return repo.data.nameWithOwner
}

function currentLogin() {
  const user = ghJson(["api", "user"])
  if (!user.ok) stop(`cannot read the GitHub user: ${user.text}`)
  if (!isLogin(user.data.login))
    stop(`the GitHub user ${user.data.login} is not a login`)
  return user.data.login
}

/** Picks the base of a re-check. A failed script reads the whole pull request. */
function recheckBase(lastHead, prBase) {
  const result = spawnSync(
    "bash",
    [join(HERE, "recheck-base.sh"), lastHead, prBase],
    { encoding: "utf8" },
  )
  if (result.stderr) process.stderr.write(result.stderr)
  const base = /^base=(.+)$/m.exec(result.stdout ?? "")?.[1]
  if (result.status === 0 && base) return base
  say(
    "The re-check base script failed, so the re-check reads the whole pull request.",
  )
  return prBase
}

async function prepare(argv) {
  const { pr: arg, effort } = readArgs(argv)
  let config
  try {
    config = readConfig()
  } catch (error) {
    stop(error.message)
  }
  restoreAfterInterruption()
  const pr = readPullRequest(arg)
  checkTree(pr)
  const repo = repository()
  const login = currentLogin()
  useGhToken()

  const out = freshOutDir()
  const statePath = join(out, "state.json")
  const { state, line } = await readState({ repo, pr: pr.number })
  writeFileSync(statePath, JSON.stringify(state, null, 2))
  say(line)

  const prBase = `origin/${pr.baseRefName}`
  const args = workflowArgs({ prBase, effort, config })
  let recheckPrompt = null
  let standInSha = null
  if (state.pass === "recheck") {
    args.base = recheckBase(state.lastHead, prBase)
    const head = git(["rev-parse", "HEAD"])
    if (head.ok && head.text !== pr.headRefOid) standInSha = head.text
    const raisedPath = join(out, "raised-findings.json")
    writeFileSync(raisedPath, JSON.stringify(state.raisedFindings, null, 2))
    args.raisedFindings = raisedPath
    if (args.base !== prBase) args.recheck = true
    recheckPrompt = join(out, "recheck-prompt.md")
    writeFileSync(
      recheckPrompt,
      readFileSync(join(HERE, "recheck-prompt.md"), "utf8")
        .replaceAll("{{STATE_PATH}}", statePath)
        .replaceAll("{{RECHECK_PATH}}", join(out, "recheck.json")),
    )
  }

  writeFileSync(
    join(out, "prepare.json"),
    JSON.stringify(
      {
        pr: pr.number,
        repo,
        login,
        headSha: pr.headRefOid,
        standInSha,
        pass: state.pass,
      },
      null,
      2,
    ),
  )
  say(
    await markSummary("started", {
      repo,
      pr: pr.number,
      headSha: pr.headRefOid,
      login,
    }),
  )
  console.log(`pass=${state.pass}`)
  console.log(`head-sha=${pr.headRefOid}`)
  console.log(`base=${prBase}`)
  console.log(`plugin-root=${PLUGIN_ROOT}`)
  console.log(`out-dir=${out}`)
  console.log(`args=${JSON.stringify(args)}`)
  if (recheckPrompt) console.log(`recheck-prompt=${recheckPrompt}`)
}

function readPrepared() {
  const path = join(outDir(), "prepare.json")
  if (!existsSync(path)) stop("no prepared pass: run prepare first")
  return JSON.parse(readFileSync(path, "utf8"))
}

/**
 * A pass that stopped between `prepare` and `post` can leave HEAD on the stand-in commit.
 * Its replay and stand-in commits would then read as unpushed work, so they go first. Only
 * that exact commit counts: another commit with the same files is real work.
 */
export function isStrandedStandIn(prepared, headSha) {
  return Boolean(prepared?.standInSha) && prepared.standInSha === headSha
}

function restoreAfterInterruption() {
  if (!existsSync(join(outDir(), "prepare.json"))) return
  const prepared = readPrepared()
  const head = git(["rev-parse", "HEAD"])
  if (head.ok && isStrandedStandIn(prepared, head.text)) {
    restoreHead(prepared.headSha)
  }
}

/** The stand-in commit holds the same files as the head, so a soft reset changes no file. */
function restoreHead(headSha) {
  const head = git(["rev-parse", "HEAD"])
  if (head.text === headSha) return
  const trees = [
    git(["rev-parse", "HEAD^{tree}"]),
    git(["rev-parse", `${headSha}^{tree}`]),
  ]
  if (!trees[0].ok || !trees[1].ok || trees[0].text !== trees[1].text) {
    stop(
      `HEAD is at ${head.text.slice(0, 10)}, whose files differ from the reviewed head ${headSha.slice(0, 10)}. Put the branch back on ${headSha.slice(0, 10)} yourself`,
    )
  }
  const reset = git(["reset", "-q", "--soft", headSha])
  if (!reset.ok) stop(`cannot put the branch back: ${reset.text}`)
  say(`Put the branch back on ${headSha.slice(0, 10)}.`)
}

async function post() {
  const prepared = readPrepared()
  restoreHead(prepared.headSha)
  useGhToken()
  const out = outDir()
  await postPass({
    repo: prepared.repo,
    pr: prepared.pr,
    headSha: prepared.headSha,
    login: prepared.login,
    resultPath: join(out, "result.json"),
    statePath: join(out, "state.json"),
    recheckPath: join(out, "recheck.json"),
  })
}

async function failed() {
  const prepared = readPrepared()
  restoreHead(prepared.headSha)
  useGhToken()
  say(await markSummary("failed", prepared))
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2)
  if (mode === "prepare") await prepare(rest)
  else if (mode === "post") await post()
  else if (mode === "failed") await failed()
  else if (mode === "restore") restoreHead(readPrepared().headSha)
  else
    stop(
      "usage: local.mjs prepare [<pr>] [--effort <level>] | post | failed | restore",
    )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
