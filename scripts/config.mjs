/**
 * Finds and reads the Maestro config of a repository. Two places hold one:
 *
 * - `team`: `.maestro/config.json` at the root of the repository, committed for everyone.
 * - `me`: `~/.maestro/<owner>/<repo>/config.json`, private to one person, for someone who
 *   cannot or does not want to commit to the repository. `<owner>/<repo>` comes from the
 *   `origin` remote, so every clone and worktree of one repository shares it.
 *
 * The team file wins. Without either file, every field takes its default (scope `none`).
 * `memoryDir`, `blueprintMap` and `workDir` come back absolute: a relative path is relative to the
 * repository root for `team` and `none`, and to the private folder for `me`, and `~` is the
 * home directory. A key that starts with `$` is documentation and never a setting.
 * `branchPattern` and `tracker` have no default.
 *
 * Run it to print the resolved config as JSON: `node scripts/config.mjs`.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const CONFIG_PATH = ".maestro/config.json"

export const DEFAULTS = {
  baseBranch: "main",
  memoryDir: ".maestro/memory",
  blueprintMap: ".maestro/blueprints/map.json",
  workDir: ".maestro/work",
  prTemplate: ".github/pull_request_template.md",
  method: "default",
  store: "github",
}

const PRIVATE_DEFAULTS = {
  memoryDir: "memory",
  blueprintMap: "blueprints/map.json",
  workDir: "work",
}

/** The root of the worktree, or `cwd` outside a git repository. */
export function gitRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], cwd) ?? cwd
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

/** `MAESTRO_HOME` moves the private folders, for tests and for a person who wants them elsewhere. */
export function maestroHome() {
  return process.env.MAESTRO_HOME || join(homedir(), ".maestro")
}

/** `owner/repo` from the `origin` remote, in its SSH or HTTPS form, or null without one. */
export function repoSlug(root = gitRoot()) {
  const url = git(["remote", "get-url", "origin"], root)
  const match = url && /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  return match ? `${match[1]}/${match[2]}` : null
}

/** The private folder of a repository, or null when it has no `origin` remote to name it by. */
export function privateDir(root = gitRoot()) {
  const slug = repoSlug(root)
  return slug ? join(maestroHome(), slug) : null
}

function expandHome(path) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path
}

/** Which file holds the config: `{ scope, path, base }`, where `base` anchors relative paths. */
export function findConfig(root = gitRoot()) {
  const teamPath = join(root, CONFIG_PATH)
  if (existsSync(teamPath)) return { scope: "team", path: teamPath, base: root }
  const dir = privateDir(root)
  if (dir && existsSync(join(dir, "config.json"))) {
    return { scope: "me", path: join(dir, "config.json"), base: dir }
  }
  return { scope: "none", path: null, base: root }
}

/** A malformed file throws, because a silent default would hide the setting somebody wrote. */
export function readConfig(root = gitRoot()) {
  const found = findConfig(root)
  let config = {}
  if (found.path) {
    try {
      config = JSON.parse(readFileSync(found.path, "utf8"))
    } catch (error) {
      throw new Error(`${found.path} is not readable JSON: ${error.message}`)
    }
  }
  const defaults = found.scope === "me" ? { ...DEFAULTS, ...PRIVATE_DEFAULTS } : DEFAULTS
  const merged = { ...defaults, ...config }
  return {
    ...merged,
    scope: found.scope,
    configPath: found.path,
    memoryDir: resolve(found.base, expandHome(merged.memoryDir)),
    blueprintMap: resolve(found.base, expandHome(merged.blueprintMap)),
    workDir: resolve(found.base, expandHome(merged.workDir)),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = gitRoot()
  console.log(
    JSON.stringify({ ...readConfig(root), repo: repoSlug(root), privateDir: privateDir(root) }, null, 2),
  )
}
