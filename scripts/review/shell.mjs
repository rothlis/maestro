/**
 * The `gh` and `git` calls of the local review. They run without a shell, so no argument is
 * ever parsed twice, and `gh` uses the login that the person already has.
 */

import { spawnSync } from "node:child_process"

export function gh(args, { input } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) return { ok: false, text: result.error.message }
  if (result.status !== 0)
    return { ok: false, text: (result.stderr || result.stdout).trim() }
  return { ok: true, text: result.stdout }
}

export function ghJson(args) {
  const result = gh(args)
  if (!result.ok) return result
  return { ok: true, data: JSON.parse(result.text) }
}

export function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0)
    return { ok: false, text: (result.stderr || result.stdout).trim() }
  return { ok: true, text: result.stdout.trim() }
}

/** Stdout carries only the result lines, so every other line goes to stderr. */
export function say(line) {
  console.error(line)
}

export function stop(line, code = 1) {
  console.error(`maestro-review: ${line}`)
  process.exit(code)
}
