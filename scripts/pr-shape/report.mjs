#!/usr/bin/env node
/**
 * Measures the shape of a branch against `skills/maestro/references/pr-shape.md`, which owns
 * the numbers and the exclusions.
 *
 *   node scripts/pr-shape/report.mjs [<base>] [<head>] [--json]
 *
 * `<base>` defaults to `origin/<baseBranch>` from `.maestro/config.json`. Extra exclusions
 * are globs in `prShape.exclude` of the same file.
 */

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { gitRoot, readConfig } from "../config.mjs"

export const THRESHOLDS = {
  lines: { target: 200, ceiling: 400 },
  files: { target: 10, ceiling: 20 },
  codeAreas: { target: 1, ceiling: 2 },
}

const LOCK_FILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "go.sum",
]

const EXCLUDED = [
  new RegExp(
    `(^|/)(${LOCK_FILES.map((name) => name.replace(/\./g, "\\.")).join("|")})$`,
  ),
  /(^|\/)__generated__\//,
  /\.generated\.[^/]+$/,
  /(^|\/)vendor\/[^/]+\.tgz$/,
]

/** The roots whose subdirectories are each one code area. */
const PACKAGE_ROOTS = ["apps", "services", "libs", "packages"]

/** Docs, CI, tooling and root config. Every top-level dot directory is one too. */
const SUPPORT_AREAS = new Set([
  "docs",
  "infra",
  "root",
  "scripts",
  "tools",
  "vendor",
])

const SIGNALS = [
  { key: "migration", test: /(^|\/)migrations?\// },
  { key: "ci-config", test: /^\.circleci\/|^\.github\/workflows\// },
]

export const toChangeStatus = (raw) =>
  /^(?:[AMDTU]|[RC]\d{1,3})$/.test(raw) ? raw : null

export const normalizePath = (raw) => {
  const braced = raw.replace(/\{([^{}]*) => ([^{}]*)\}/g, "$2")
  const arrow = braced.split(" => ")
  return (arrow[arrow.length - 1] ?? braced).replace(/\/{2,}/g, "/")
}

/** `**` matches any depth, `*` and `?` stay inside one path segment. */
export const globToRegex = (glob) => {
  let source = ""
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === "*" && glob[index + 1] === "*") {
      const isSegment = glob[index + 2] === "/"
      source += isSegment ? "(?:.*/)?" : ".*"
      index += isSegment ? 2 : 1
    } else if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}$`)
}

/** The exclusions of the reference, and the globs of `prShape.exclude`. */
export const exclusions = (globs = []) => [
  ...EXCLUDED,
  ...globs.map(globToRegex),
]

export const isExcluded = (path, patterns = EXCLUDED) =>
  patterns.some((pattern) => pattern.test(path))

export const areaOf = (path) => {
  const [first, second] = path.split("/")
  if (!first) return "root"
  if (second === undefined) return "root"
  if (PACKAGE_ROOTS.includes(first) && path.split("/").length > 2) {
    return `${first}/${second}`
  }
  return first
}

export const isCodeArea = (area) => {
  const top = area.split("/")[0] ?? area
  return !SUPPORT_AREAS.has(top) && !top.startsWith(".")
}

/** A module under an app or a service, or else the app or the service itself. */
export const domainOf = (path) => {
  const module =
    /^((?:apps|services)\/[^/]+)\/(?:[^/]+\/)*?modules\/([^/]+)\//.exec(path)
  if (module) return `${module[1]}:${module[2]}`
  const deployable = /^((?:apps|services)\/[^/]+)\//.exec(path)
  return deployable ? deployable[1] : null
}

export const subsumeDomains = (domains) => {
  const scoped = new Set(
    domains.filter((d) => d.includes(":")).map((d) => d.split(":")[0]),
  )
  return domains.filter((d) => d.includes(":") || !scoped.has(d))
}

/**
 * The layer of a hexagonal service: a folder under `app-core/`, or a top-level folder of a
 * service's `src/` or of one of its modules. A path in no such folder has no layer.
 */
export const layerOf = (path) => {
  const appCore = /\/app-core\/([^/]+)\//.exec(path)
  if (appCore) return `app-core/${appCore[1]}`
  const layer =
    /^services\/[^/]+\/(?:[^/]+\/)*?src\/(?:modules\/[^/]+\/)?(api|infra|jobs|commands|config)\//.exec(
      path,
    )
  return layer?.[1] ?? null
}

export const signalsFor = (paths) =>
  SIGNALS.filter((s) => paths.some((p) => s.test.test(p))).map((s) => s.key)

export const countLines = (file) => {
  if (file.status === "D") return 1
  if (file.added === 0 && file.deleted === 0) return 0
  return file.added + file.deleted
}

export const parseNumstat = (out) => {
  const result = new Map()
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const [added, deleted, ...rest] = line.split("\t")
    const path = normalizePath(rest.join("\t"))
    if (!path) continue
    result.set(path, {
      added: added === "-" ? 0 : Number(added),
      deleted: deleted === "-" ? 0 : Number(deleted),
    })
  }
  return result
}

export const parseNameStatus = (out) => {
  const result = new Map()
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    const status = toChangeStatus(parts[0] ?? "")
    const path = normalizePath(parts[parts.length - 1] ?? "")
    if (status && path) result.set(path, status)
  }
  return result
}

export const buildFiles = (numstat, nameStatus) =>
  [...numstat.entries()].map(([path, counts]) => {
    const status = nameStatus.get(path)
    if (!status) {
      throw new Error(
        `pr-shape: git diff --numstat listed ${path} but --name-status did not. Refusing to guess its status.`,
      )
    }
    return { path, added: counts.added, deleted: counts.deleted, status }
  })

export const summarize = (base, files, commits, patterns = EXCLUDED) => {
  const kept = (path) => !isExcluded(path, patterns)
  const counted = files.filter((f) => kept(f.path))
  const uniq = (values) =>
    [...new Set(values.filter((v) => v !== null))].sort()

  const areas = uniq(counted.map((f) => areaOf(f.path)))
  const codeAreas = areas.filter(isCodeArea)
  const supportAreas = areas.filter((a) => !isCodeArea(a))

  const totalLines = counted.reduce((sum, f) => sum + countLines(f), 0)
  const reviewableFiles = counted.filter((f) => f.status !== "D")
  const domains = subsumeDomains(uniq(counted.map((f) => domainOf(f.path))))

  const straddlingCommits = commits
    .map((c) => ({
      sha: c.sha.slice(0, 10),
      subject: c.subject,
      areas: uniq(c.paths.filter(kept).map(areaOf)).filter(isCodeArea),
    }))
    .filter((c) => c.areas.length > 1)

  const measured = [
    ["lines", totalLines],
    ["files", reviewableFiles.length],
    ["codeAreas", codeAreas.length],
  ]
  const breaches = measured
    .filter(([measure, value]) => value > THRESHOLDS[measure].ceiling)
    .map(([measure, value]) => ({
      measure,
      value,
      ceiling: THRESHOLDS[measure].ceiling,
    }))

  const concernSignals = []
  if (
    codeAreas.some((a) => a.startsWith("apps/")) &&
    codeAreas.some((a) => a.startsWith("services/"))
  ) {
    concernSignals.push("touches both apps/ and services/")
  }
  if (straddlingCommits.length > 0) {
    concernSignals.push(
      `${straddlingCommits.length} commit(s) straddle more than one code area`,
    )
  }
  if (domains.length > 1) {
    concernSignals.push("touches more than one product domain")
  }

  return {
    base,
    lines: {
      counted: totalLines,
      raw: files.reduce((sum, f) => sum + f.added + f.deleted, 0),
    },
    files: {
      counted: reviewableFiles.length,
      excluded: files.length - counted.length,
      renamed: counted.filter((f) => f.status.startsWith("R")).length,
      deleted: counted.filter((f) => f.status === "D").length,
    },
    codeAreas,
    supportAreas,
    domains,
    layers: uniq(counted.map((f) => layerOf(f.path))),
    signals: signalsFor(counted.map((f) => f.path)),
    straddlingCommits,
    breaches,
    concernSignals,
  }
}

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })

const collect = (base, head, patterns) => {
  const range = `${base}...${head}`
  const files = buildFiles(
    parseNumstat(git(["diff", "--numstat", "-M", range])),
    parseNameStatus(git(["diff", "--name-status", "-M", range])),
  )
  const commits = git(["log", "--format=%H%x09%s", `${base}..${head}`])
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [sha = "", ...subject] = line.split("\t")
      return {
        sha,
        subject: subject.join("\t"),
        paths: git(["show", "--name-only", "--format=", sha])
          .split("\n")
          .filter((path) => path.trim()),
      }
    })
  return summarize(base, files, commits, patterns)
}

const measureRow = (label, value, detail) => {
  const { target, ceiling } = THRESHOLDS[label]
  const head = `  ${label.padEnd(10)} ${String(value).padEnd(5)}`
  return `${head} target ${target}, ceiling ${ceiling}   ${detail}`
}

export const render = (r) => {
  const verdict =
    r.breaches.length === 0 ? "within thresholds" : "past a ceiling"
  const lines = [
    `pr-shape vs ${r.base} — ${verdict}`,
    "",
    measureRow("lines", r.lines.counted, `(${r.lines.raw} raw)`),
    measureRow(
      "files",
      r.files.counted,
      `reviewable · ${r.files.excluded} excluded, ${r.files.renamed} renamed, ${r.files.deleted} deleted`,
    ),
    measureRow(
      "codeAreas",
      r.codeAreas.length,
      r.codeAreas.join(", ") || "none",
    ),
    `  support    ${r.supportAreas.join(", ") || "none"}`,
  ]
  if (r.domains.length) lines.push(`  domains    ${r.domains.join(", ")}`)
  if (r.layers.length) lines.push(`  layers     ${r.layers.join(", ")}`)
  if (r.signals.length) lines.push(`  signals    ${r.signals.join(", ")}`)
  if (r.straddlingCommits.length) {
    lines.push("", "  commits touching more than one code area:")
    for (const c of r.straddlingCommits) {
      lines.push(`    ${c.sha} ${c.subject} [${c.areas.join(", ")}]`)
    }
  }
  if (r.breaches.length) {
    lines.push("", "  past a ceiling:")
    for (const b of r.breaches) {
      lines.push(`    - ${b.measure} ${b.value} over ceiling ${b.ceiling}`)
    }
  }
  if (r.concernSignals.length) {
    lines.push("", "  may carry more than one concern:")
    for (const s of r.concernSignals) lines.push(`    - ${s}`)
  }
  return lines.join("\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const positional = args.filter((a) => !a.startsWith("--"))
  const config = readConfig(gitRoot())
  const report = collect(
    positional[0] ?? `origin/${config.baseBranch}`,
    positional[1] ?? "HEAD",
    exclusions(config.prShape?.exclude ?? []),
  )
  console.log(
    args.includes("--json") ? JSON.stringify(report, null, 2) : render(report),
  )
}
