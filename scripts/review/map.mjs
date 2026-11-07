/**
 * Resolves each routed file to the GitHub team that owns it, from the blueprint map that
 * `blueprintMap` in the config names: a team that must review the change, or a
 * team that must only know about it. The review names files and rules, and this file names
 * the team, so a model never picks a team.
 *
 * A team is an `org/team` slug, as GitHub writes it after `@`. A repository with no map has
 * no teams, and that is no error.
 */

import { existsSync, readFileSync } from "node:fs"

import { gitRoot, readConfig } from "../config.mjs"
import { warn } from "./github.mjs"

export const EMPTY_MAP = { surfaces: [], uncovered: [], uncoveredReviewTeams: {} }

/** A missing map is no error. A malformed one is a warning, because the pass is already posted. */
export function readMap(root = gitRoot()) {
  try {
    const path = readConfig(root).blueprintMap
    if (!existsSync(path)) return EMPTY_MAP
    const map = JSON.parse(readFileSync(path, "utf8"))
    return { ...EMPTY_MAP, ...map, surfaces: map.surfaces ?? [] }
  } catch (error) {
    warn(`Reading the blueprint map failed (${error.message}), so no file has a team.`)
    return EMPTY_MAP
  }
}

/** `*` matches one path segment, and a path matches at any depth unless it is root-only. */
function toPathRegex(path, isRootOnly) {
  const escaped = path
    .replace(/\/$/, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]+")
  return new RegExp(`${isRootOnly ? "^" : "(?:^|/)"}${escaped}(?:/|$)`)
}

/** Each path that carries a team. An uncovered path holds at the root only. */
function teamRoutes(map) {
  const surfaceRoutes = map.surfaces
    .filter((surface) => surface.reviewTeam)
    .flatMap((surface) =>
      (surface.paths ?? []).map((path) => ({
        path,
        team: surface.reviewTeam,
        regex: toPathRegex(path, Boolean(surface.rootOnly)),
      })),
    )
  const uncoveredRoutes = Object.entries(map.uncoveredReviewTeams ?? {}).map(
    ([path, team]) => ({ path, team, regex: toPathRegex(path, true) }),
  )
  return [...surfaceRoutes, ...uncoveredRoutes]
}

/** The longest matching path wins, so `services/payments/` beats `services/*\/`. */
export function teamFor(file, map) {
  const matches = teamRoutes(map).filter((route) => route.regex.test(file))
  if (!matches.length) return null
  return matches.sort((a, b) => b.path.length - a.path.length)[0].team
}

const LEVEL_ORDER = { review: 0, aware: 1 }

/**
 * One entry for each team that a reason names, with its reasons. A team is at the `review`
 * level when one of its reasons is, and at `aware` otherwise. A reason with no level is a
 * `review` one. `unowned` holds the reasons whose file no team covers.
 */
export function teamPlan(reasons, map) {
  const byTeam = new Map()
  const unowned = []
  for (const reason of reasons) {
    const level = reason.level === "aware" ? "aware" : "review"
    const team = teamFor(reason.file, map)
    if (!team) {
      unowned.push({ ...reason, level })
      continue
    }
    const entry = byTeam.get(team) ?? { team, level: "aware", reasons: [] }
    if (level === "review") entry.level = "review"
    entry.reasons.push({ ...reason, level })
    byTeam.set(team, entry)
  }
  const teams = [...byTeam.values()].sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      a.team.localeCompare(b.team),
  )
  return { teams, unowned }
}
