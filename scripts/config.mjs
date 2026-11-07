/**
 * Reads `.maestro/config.json` at the root of the repository that uses the plugin. The file
 * is optional, and each field it leaves out takes its default. A key that starts with `$`,
 * such as `$comment`, is documentation and never a setting. `branchPattern` is a top-level
 * field and has no default: without it, build names the branch in plain kebab-case. `tracker`
 * has no default either: it matters only when `store` is "tracker".
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const CONFIG_PATH = ".maestro/config.json"

export const DEFAULTS = {
  baseBranch: "main",
  memoryDir: ".maestro/memory",
  blueprintMap: ".maestro/blueprints/map.json",
  prTemplate: ".github/pull_request_template.md",
  method: "default",
  store: "github",
}

/** The root of the worktree, or `cwd` outside a git repository. */
export function gitRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return cwd
  }
}

/** A malformed file throws, because a silent default would hide the setting the team wrote. */
export function readConfig(root = gitRoot()) {
  const path = join(root, CONFIG_PATH)
  if (!existsSync(path)) return { ...DEFAULTS }
  let config
  try {
    config = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`${CONFIG_PATH} is not readable JSON: ${error.message}`)
  }
  return { ...DEFAULTS, ...config }
}
