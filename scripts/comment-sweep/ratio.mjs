#!/usr/bin/env node
/**
 * Counts the comment lines and the code lines that a change adds, for the comment-density
 * check of `skills/maestro/review/references/method.md`. That file owns the rule and the
 * threshold. This command only measures, so a review does not improvise its own counter.
 *
 * `node scripts/comment-sweep/ratio.mjs [<base>] [-- <path>...]`
 *
 * `<base>` defaults to `origin/<baseBranch>` from `.maestro/config.json`.
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { extname } from "node:path"
import { fileURLToPath } from "node:url"

import { gitRoot, readConfig } from "../config.mjs"

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
])

export function isCounted(filePath) {
  if (!SOURCE_EXTENSIONS.has(extname(filePath))) return false
  const isTest =
    /\.(test|spec|stories|eval)(\.browser)?\.[cm]?[jt]sx?$/.test(filePath) ||
    /(^|\/)__tests__\//.test(filePath)
  return !isTest
}

/**
 * Classifies the lines of one hunk in order. A hunk shows only three lines before a
 * change, so a `/* *\/` block that opened earlier is invisible: a JSDoc line (`* text`,
 * `*\/`) counts as a comment for that reason, and a block line without a `*` counts as code.
 */
function lineClassifier() {
  let isInsideBlock = false
  return (text) => {
    const line = text.trim()
    if (line === "") return "blank"
    if (isInsideBlock) {
      if (line.includes("*/")) isInsideBlock = false
      return "comment"
    }
    if (line.startsWith("//") || /^\*(\s|\/|$)/.test(line)) return "comment"
    if (line.startsWith("/*")) {
      isInsideBlock = !line.includes("*/", 2)
      return "comment"
    }
    return "code"
  }
}

/** Counts the added lines of a unified diff, one entry per counted file. */
export function countDiff(diff) {
  const files = []
  let current = null
  let classify = null
  let isNewFile = false
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      current = null
      isNewFile = false
      continue
    }
    if (raw.startsWith("new file mode") || raw === "--- /dev/null") {
      isNewFile = true
      continue
    }
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).replace(/^b\//, "")
      current =
        path !== "/dev/null" && isCounted(path)
          ? { file: path, comment: 0, code: 0, isNew: isNewFile }
          : null
      if (current) files.push(current)
      classify = lineClassifier()
      continue
    }
    if (raw.startsWith("@@")) {
      classify = lineClassifier()
      continue
    }
    if (!current || raw.startsWith("--- ")) continue
    if (raw.startsWith("-")) continue
    const kind = classify(raw.slice(1))
    if (raw.startsWith("+") && kind !== "blank") current[kind] += 1
  }
  return files.filter((f) => f.comment + f.code > 0)
}

/** A file git does not track yet is all added lines. */
function untrackedAsDiff(paths) {
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", ...paths],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
  return untracked
    .map((file) => {
      const added = readFileSync(file, "utf8")
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n")
      return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n${added}`
    })
    .join("\n")
}

export function report(files) {
  const comment = files.reduce((sum, f) => sum + f.comment, 0)
  const code = files.reduce((sum, f) => sum + f.code, 0)
  return {
    comment,
    code,
    ratio: comment + code === 0 ? 0 : comment / (comment + code),
    newFilesWithMoreCommentThanCode: files
      .filter((f) => f.isNew && f.comment > f.code)
      .map((f) => f.file),
    files,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const separator = args.indexOf("--")
  const paths = separator === -1 ? [] : args.slice(separator + 1)
  const base =
    (separator === -1 ? args : args.slice(0, separator))[0] ??
    `origin/${readConfig(gitRoot()).baseBranch}`
  const mergeBase = execFileSync(
    "git",
    ["merge-base", base, "HEAD"],
    { encoding: "utf8" },
  ).trim()
  const diff = execFileSync(
    "git",
    ["diff", "--no-color", "--no-ext-diff", mergeBase, "--", ...paths],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  )
  const files = countDiff(`${diff}\n${untrackedAsDiff(paths)}`)
  console.log(
    JSON.stringify({ base, ...report(files) }, null, 2),
  )
}
