import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { readConfig, repoSlug } from "./config.mjs"

function setup(t, remote = "git@github.com:acme/shop.git") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "maestro-config-")))
  const root = join(dir, "repo")
  const home = join(dir, "home")
  mkdirSync(root)
  execFileSync("git", ["init", "-q"], { cwd: root })
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: root })
  const previous = process.env.MAESTRO_HOME
  process.env.MAESTRO_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.MAESTRO_HOME
    else process.env.MAESTRO_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  })
  return { root, home }
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

test("the slug comes from an SSH or an HTTPS remote", (t) => {
  const { root } = setup(t, "https://github.com/acme/shop")
  assert.equal(repoSlug(root), "acme/shop")
  execFileSync("git", ["remote", "set-url", "origin", "git@github.com:acme/shop.git"], {
    cwd: root,
  })
  assert.equal(repoSlug(root), "acme/shop")
})

test("without a config, every path sits in the repository", (t) => {
  const { root } = setup(t)
  const config = readConfig(root)
  assert.equal(config.scope, "none")
  assert.equal(config.memoryDir, join(root, ".maestro/memory"))
  assert.equal(config.blueprintMap, join(root, ".maestro/blueprints/map.json"))
})

test("a private config sits in the home folder, and its paths are relative to it", (t) => {
  const { root, home } = setup(t)
  writeJson(join(home, "acme/shop/config.json"), { method: "shape-up" })
  const config = readConfig(root)
  assert.equal(config.scope, "me")
  assert.equal(config.method, "shape-up")
  assert.equal(config.memoryDir, join(home, "acme/shop/memory"))
  assert.equal(config.blueprintMap, join(home, "acme/shop/blueprints/map.json"))
  assert.equal(config.workDir, join(home, "acme/shop/work"))
})

test("a private config can point at a shared folder with ~", (t) => {
  const { root, home } = setup(t)
  writeJson(join(home, "acme/shop/config.json"), { memoryDir: "~/team/memory" })
  assert.equal(readConfig(root).memoryDir, join(homedir(), "team/memory"))
})

test("the team config wins over a private one", (t) => {
  const { root, home } = setup(t)
  writeJson(join(home, "acme/shop/config.json"), { method: "shape-up" })
  writeJson(join(root, ".maestro/config.json"), { method: "default" })
  const config = readConfig(root)
  assert.equal(config.scope, "team")
  assert.equal(config.method, "default")
})

test("a repository with no remote has no private config", (t) => {
  const { root } = setup(t, null)
  assert.equal(readConfig(root).scope, "none")
})
