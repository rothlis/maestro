/**
 * Run with `node --test scripts/review/recheck-base.test.mjs`.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = new URL("./recheck-base.sh", import.meta.url).pathname

const repository = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "maestro-recheck-base-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
  git("init", "-q", "-b", "main")
  git("config", "user.name", "Test")
  git("config", "user.email", "test@example.com")
  const commit = (files, message) => {
    for (const [name, text] of Object.entries(files)) {
      if (text === null) git("rm", "-q", name)
      else {
        writeFileSync(join(dir, name), text)
        git("add", name)
      }
    }
    git("commit", "-q", "-m", message)
    return git("rev-parse", "HEAD")
  }
  const recheckBase = (lastHead) => {
    const run = spawnSync("bash", [SCRIPT, lastHead, "main"], {
      cwd: dir,
      encoding: "utf8",
    })
    assert.equal(run.status, 0, run.stderr)
    return {
      base: run.stdout.trim().replace(/^base=/, ""),
      notice: run.stderr.trim(),
    }
  }
  return { git, commit, recheckBase }
}

const lines = (...values) => values.join("\n") + "\n"

const rebaseOverALineConflict = (t, resolvedLine) => {
  const { git, commit, recheckBase } = repository(t)
  commit({ "a.ts": lines("one", "two", "three"), "b.ts": "b\n" }, "base")
  git("checkout", "-q", "-b", "feature")
  const lastHead = commit(
    { "a.ts": lines("one", "two from the pr", "three"), "c.ts": "reviewed\n" },
    "reviewed change",
  )
  git("checkout", "-q", "main")
  commit({ "a.ts": lines("one", "two from main", "three") }, "main moves")
  git("checkout", "-q", "-B", "feature", "main")
  commit(
    { "a.ts": lines("one", resolvedLine, "three"), "c.ts": "reviewed\n" },
    "rebased change",
  )
  commit({ "d.ts": "new\n" }, "new change")
  const { base, notice } = recheckBase(lastHead)
  return { base, notice, changed: git("diff", "--name-only", `${base}...HEAD`) }
}

test("a rebase that conflicts on a line re-checks only the resolution and the new commit", (t) => {
  const { base, notice, changed } = rebaseOverALineConflict(
    t,
    "two from the pr and main",
  )

  assert.notEqual(base, "main")
  assert.deepEqual(changed.split("\n"), ["a.ts", "d.ts"])
  assert.match(notice, /conflict with main in a\.ts\./)
})

test("a resolution that keeps the line of the pull request over the line of the base is re-checked", (t) => {
  const { base, changed } = rebaseOverALineConflict(t, "two from the pr")

  assert.notEqual(base, "main")
  assert.deepEqual(changed.split("\n"), ["a.ts", "d.ts"])
})

test("a conflict that a line merge cannot settle re-checks the whole pull request", (t) => {
  const { git, commit, recheckBase } = repository(t)
  commit({ "a.ts": "a\n" }, "base")
  git("checkout", "-q", "-b", "feature")
  const lastHead = commit({ "a.ts": "a from the pr\n" }, "reviewed change")
  git("checkout", "-q", "main")
  commit({ "a.ts": null }, "main deletes the file")
  git("checkout", "-q", "-B", "feature", "main")
  commit({ "a.ts": "a from the pr\n" }, "rebased change")

  assert.equal(recheckBase(lastHead).base, "main")
})
