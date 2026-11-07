import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  areaOf,
  buildFiles,
  countLines,
  domainOf,
  exclusions,
  globToRegex,
  isCodeArea,
  isExcluded,
  layerOf,
  normalizePath,
  parseNameStatus,
  parseNumstat,
  signalsFor,
  subsumeDomains,
  summarize,
  THRESHOLDS,
  toChangeStatus,
} from "./report.mjs"

describe("normalizePath", () => {
  it("takes the new side of a braced rename", () => {
    assert.equal(normalizePath("libs/{old => new}/index.ts"), "libs/new/index.ts")
  })

  it("takes the new side of a whole-path rename", () => {
    assert.equal(normalizePath("old.ts => new.ts"), "new.ts")
  })

  it("leaves an ordinary path alone", () => {
    assert.equal(normalizePath("apps/web/src/index.ts"), "apps/web/src/index.ts")
  })
})

describe("toChangeStatus", () => {
  it("accepts every status git emits", () => {
    for (const raw of ["A", "M", "D", "T", "U", "R100", "R087", "C75"]) {
      assert.equal(toChangeStatus(raw), raw)
    }
  })

  it("rejects anything else", () => {
    for (const raw of ["", "X", "MM", "R", "Rabc", "1"]) {
      assert.equal(toChangeStatus(raw), null, raw)
    }
  })
})

describe("isExcluded", () => {
  it("excludes lock files, generated files and vendored archives", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "apps/web/package-lock.json",
      "libs/reports/src/__generated__/gql.ts",
      "libs/theme/colors.generated.css",
      "vendor/icons-6.tgz",
    ]) {
      assert.equal(isExcluded(path), true, path)
    }
  })

  it("counts everything else", () => {
    for (const path of [
      "package.json",
      "services/api/db/schema.sql",
      "apps/web/src/modules/billing/InvoicePage.tsx",
      "docs/memory/MEMORY.md",
      "docs/diagrams/context.svg",
    ]) {
      assert.equal(isExcluded(path), false, path)
    }
  })

  it("adds the globs of prShape.exclude", () => {
    const patterns = exclusions(["docs/diagrams/**", "**/*.snap"])
    assert.equal(isExcluded("docs/diagrams/context.svg", patterns), true)
    assert.equal(isExcluded("apps/web/src/__snapshots__/a.snap", patterns), true)
    assert.equal(isExcluded("pnpm-lock.yaml", patterns), true)
    assert.equal(isExcluded("docs/guide.md", patterns), false)
  })
})

describe("globToRegex", () => {
  it("keeps a single star inside one segment", () => {
    assert.equal(globToRegex("vendor/*.tgz").test("vendor/a.tgz"), true)
    assert.equal(globToRegex("vendor/*.tgz").test("vendor/x/a.tgz"), false)
  })

  it("lets a double star cross segments, or none", () => {
    assert.equal(globToRegex("**/gen/**").test("gen/a.ts"), true)
    assert.equal(globToRegex("**/gen/**").test("a/b/gen/c/d.ts"), true)
  })
})

describe("areaOf", () => {
  it("maps each path to its area", () => {
    for (const [path, area] of [
      ["apps/web/src/index.ts", "apps/web"],
      ["services/api/src/router.ts", "services/api"],
      ["libs/dates/src/index.ts", "libs/dates"],
      ["packages/ui/src/Button.tsx", "packages/ui"],
      ["src/main.go", "src"],
      [".circleci/config.yml", ".circleci"],
      ["docs/memory/MEMORY.md", "docs"],
      ["package.json", "root"],
    ]) {
      assert.equal(areaOf(path), area, path)
    }
  })
})

describe("isCodeArea", () => {
  it("counts packages and top-level source directories", () => {
    for (const area of ["apps/web", "services/api", "libs/dates", "src", "e2e"]) {
      assert.equal(isCodeArea(area), true, area)
    }
  })

  it("does not count docs, CI, tooling or root config", () => {
    for (const area of ["docs", ".circleci", ".github", ".claude", "scripts", "root"]) {
      assert.equal(isCodeArea(area), false, area)
    }
  })
})

describe("domainOf", () => {
  it("reads an app module", () => {
    assert.equal(
      domainOf("apps/web/src/modules/billing/invoice/InvoicePage.tsx"),
      "apps/web:billing",
    )
  })

  it("reads a service module", () => {
    assert.equal(
      domainOf("services/api/server/src/modules/orders/api/router.ts"),
      "services/api:orders",
    )
  })

  it("falls back to the service for a path with no modules folder", () => {
    for (const [path, domain] of [
      ["services/jobs/src/app-core/use-cases/run-job.ts", "services/jobs"],
      ["services/payments/src/api/webhooks/stripe.ts", "services/payments"],
      ["services/api/db/schema.sql", "services/api"],
    ]) {
      assert.equal(domainOf(path), domain, path)
    }
  })

  it("falls back to the app for a path outside any module", () => {
    assert.equal(domainOf("apps/admin/src/main.tsx"), "apps/admin")
  })

  it("returns null outside apps and services", () => {
    assert.equal(domainOf("libs/dates/src/index.ts"), null)
  })
})

describe("subsumeDomains", () => {
  it("drops the bare service when one of its modules is present", () => {
    assert.deepEqual(subsumeDomains(["services/api", "services/api:orders"]), [
      "services/api:orders",
    ])
  })

  it("keeps a bare service that has no module of its own in the diff", () => {
    assert.deepEqual(subsumeDomains(["services/payments", "services/search"]), [
      "services/payments",
      "services/search",
    ])
  })

  it("leaves a list of modules alone", () => {
    assert.deepEqual(subsumeDomains(["apps/web:billing", "apps/web:setup"]), [
      "apps/web:billing",
      "apps/web:setup",
    ])
  })
})

describe("layerOf", () => {
  it("names the hexagonal layer", () => {
    assert.equal(
      layerOf("services/api/src/modules/orders/app-core/ports/repo.ts"),
      "app-core/ports",
    )
  })

  it("names a top-level service layer", () => {
    assert.equal(layerOf("services/payments/src/api/webhooks/stripe.ts"), "api")
  })

  it("names the module-nested layer", () => {
    for (const [path, layer] of [
      ["services/api/src/modules/orders/infra/order.repository.ts", "infra"],
      ["services/api/server/src/modules/search/jobs/reindex.ts", "jobs"],
    ]) {
      assert.equal(layerOf(path), layer, path)
    }
  })

  it("returns null for a frontend path", () => {
    assert.equal(layerOf("apps/web/src/index.ts"), null)
  })
})

describe("countLines", () => {
  it("counts a deleted file as one line", () => {
    assert.equal(countLines({ added: 0, deleted: 900, status: "D" }), 1)
  })

  it("counts a pure rename as nothing", () => {
    assert.equal(countLines({ added: 0, deleted: 0, status: "R100" }), 0)
  })

  it("counts a rename that also changed content", () => {
    assert.equal(countLines({ added: 4, deleted: 2, status: "R087" }), 6)
  })

  it("adds both sides of an ordinary edit", () => {
    assert.equal(countLines({ added: 10, deleted: 3, status: "M" }), 13)
  })
})

describe("parseNumstat", () => {
  it("reads added and deleted counts per path", () => {
    const out = "10\t3\tapps/web/src/a.ts\n0\t0\tlibs/{old => new}/b.ts\n"
    assert.deepEqual(
      [...parseNumstat(out)],
      [
        ["apps/web/src/a.ts", { added: 10, deleted: 3 }],
        ["libs/new/b.ts", { added: 0, deleted: 0 }],
      ],
    )
  })

  it("reads a binary file as zero lines", () => {
    assert.deepEqual(parseNumstat("-\t-\tvendor/x.tgz\n").get("vendor/x.tgz"), {
      added: 0,
      deleted: 0,
    })
  })
})

describe("parseNameStatus", () => {
  it("keeps the new path of a rename", () => {
    const out = "M\tapps/web/src/a.ts\nR100\told.ts\tnew.ts\nD\tgone.ts\n"
    assert.deepEqual(
      [...parseNameStatus(out)],
      [
        ["apps/web/src/a.ts", "M"],
        ["new.ts", "R100"],
        ["gone.ts", "D"],
      ],
    )
  })

  it("drops a line whose status git never emits", () => {
    assert.deepEqual([...parseNameStatus("X\tweird.ts\n")], [])
  })
})

describe("buildFiles", () => {
  it("refuses to guess when the two git outputs disagree", () => {
    assert.throws(
      () => buildFiles(new Map([["a.ts", { added: 1, deleted: 0 }]]), new Map()),
      /--name-status did not/,
    )
  })
})

describe("signalsFor", () => {
  it("finds a migration and CI configuration", () => {
    for (const [key, path] of [
      ["migration", "services/api/db/migrations/20260101_x/migration.sql"],
      ["migration", "apps/web/migration/001.sql"],
      ["ci-config", ".circleci/config.yml"],
      ["ci-config", ".github/workflows/test.yml"],
    ]) {
      assert.ok(signalsFor([path]).includes(key), path)
    }
  })

  it("finds nothing in ordinary source", () => {
    assert.deepEqual(signalsFor(["libs/dates/src/index.ts"]), [])
  })
})

describe("summarize", () => {
  const files = (rows) =>
    buildFiles(
      new Map(rows.map(([p, n]) => [p, { added: n, deleted: 0 }])),
      new Map(rows.map(([p, , s]) => [p, s])),
    )

  it("passes a small, coherent change", () => {
    const report = summarize(
      "origin/main",
      files([["libs/dates/src/index.ts", 40, "M"]]),
      [],
    )
    assert.deepEqual(report.breaches, [])
    assert.deepEqual(report.concernSignals, [])
    assert.equal(report.lines.counted, 40)
    assert.deepEqual(report.codeAreas, ["libs/dates"])
  })

  it("keeps the fields of the report", () => {
    const report = summarize("origin/main", [], [])
    assert.deepEqual(Object.keys(report), [
      "base",
      "lines",
      "files",
      "codeAreas",
      "supportAreas",
      "domains",
      "layers",
      "signals",
      "straddlingCommits",
      "breaches",
      "concernSignals",
    ])
    assert.deepEqual(Object.keys(report.lines), ["counted", "raw"])
    assert.deepEqual(Object.keys(report.files), [
      "counted",
      "excluded",
      "renamed",
      "deleted",
    ])
  })

  it("does not count an excluded file toward lines or areas", () => {
    const report = summarize(
      "origin/main",
      files([["pnpm-lock.yaml", 5000, "M"]]),
      [],
    )
    assert.equal(report.lines.counted, 0)
    assert.equal(report.lines.raw, 5000)
    assert.equal(report.files.counted, 0)
    assert.equal(report.files.excluded, 1)
    assert.deepEqual(report.breaches, [])
  })

  it("does not count a file that a configured glob excludes", () => {
    const report = summarize(
      "origin/main",
      files([["docs/diagrams/a.svg", 900, "M"]]),
      [],
      exclusions(["docs/diagrams/**"]),
    )
    assert.equal(report.lines.counted, 0)
    assert.equal(report.files.excluded, 1)
  })

  it("does not count docs and CI as code areas", () => {
    const report = summarize(
      "origin/main",
      files([
        [".circleci/config.yml", 30, "M"],
        ["docs/memory/MEMORY.md", 4, "M"],
        ["package.json", 1, "M"],
      ]),
      [],
    )
    assert.deepEqual(report.codeAreas, [])
    assert.deepEqual(report.supportAreas, [".circleci", "docs", "root"])
    assert.deepEqual(report.breaches, [])
  })

  it("charges a deleted file one line and leaves it out of the file count", () => {
    const report = summarize(
      "origin/main",
      files([["libs/dates/src/old.ts", 0, "D"]]),
      [],
    )
    assert.equal(report.lines.counted, 1)
    assert.equal(report.files.counted, 0)
    assert.equal(report.files.deleted, 1)
  })

  it("does not breach the file ceiling on a deletion-only change of 450 files", () => {
    const rows = Array.from({ length: 450 }, (_, i) => [
      `libs/dates/src/old-${i}.ts`,
      0,
      "D",
    ])
    const report = summarize("origin/main", files(rows), [])
    assert.equal(report.lines.counted, 450)
    assert.equal(report.files.counted, 0)
    assert.deepEqual(
      report.breaches.map((b) => b.measure),
      ["lines"],
    )
  })

  it("counts a rename toward the renamed tally", () => {
    const report = summarize(
      "origin/main",
      files([["libs/dates/src/new.ts", 0, "R100"]]),
      [],
    )
    assert.equal(report.files.renamed, 1)
    assert.equal(report.lines.counted, 0)
  })

  it("passes at exactly the ceiling on every measure", () => {
    const rows = Array.from({ length: THRESHOLDS.files.ceiling }, (_, i) => [
      `libs/lib-${i % THRESHOLDS.codeAreas.ceiling}/src/f-${i}.ts`,
      THRESHOLDS.lines.ceiling / THRESHOLDS.files.ceiling,
      "M",
    ])
    const report = summarize("origin/main", files(rows), [])
    assert.equal(report.lines.counted, THRESHOLDS.lines.ceiling)
    assert.equal(report.files.counted, THRESHOLDS.files.ceiling)
    assert.equal(report.codeAreas.length, THRESHOLDS.codeAreas.ceiling)
    assert.deepEqual(report.breaches, [])
  })

  it("reports crossing the client and the server as a concern, not a breach", () => {
    const report = summarize(
      "origin/main",
      files([
        ["apps/web/src/a.tsx", 10, "M"],
        ["services/api/src/api/b.ts", 10, "M"],
      ]),
      [],
    )
    assert.deepEqual(report.breaches, [])
    assert.ok(report.concernSignals.includes("touches both apps/ and services/"))
  })

  it("reports two single-module services as two domains", () => {
    const report = summarize(
      "origin/main",
      files([
        ["services/payments/src/api/webhooks/stripe.ts", 5, "M"],
        ["services/search/src/api/query.ts", 5, "M"],
      ]),
      [],
    )
    assert.deepEqual(report.domains, ["services/payments", "services/search"])
    assert.ok(
      report.concernSignals.includes("touches more than one product domain"),
    )
  })

  it("reads a multi-module service touched outside its modules as one domain", () => {
    const report = summarize(
      "origin/main",
      files([
        ["services/api/src/modules/orders/app-core/repo.ts", 5, "M"],
        ["services/api/src/api/router.ts", 5, "M"],
      ]),
      [],
    )
    assert.deepEqual(report.domains, ["services/api:orders"])
    assert.deepEqual(report.concernSignals, [])
  })

  it("reports two product domains as a concern", () => {
    const report = summarize(
      "origin/main",
      files([
        ["apps/web/src/modules/billing/a.tsx", 5, "M"],
        ["apps/web/src/modules/setup/b.tsx", 5, "M"],
      ]),
      [],
    )
    assert.ok(
      report.concernSignals.includes("touches more than one product domain"),
    )
  })

  it("reports each ceiling it passes, with the value and the ceiling", () => {
    const many = Array.from({ length: 25 }, (_, i) => [
      `libs/lib-${i}/src/index.ts`,
      30,
      "M",
    ])
    const report = summarize("origin/main", files(many), [])
    assert.deepEqual(report.breaches, [
      { measure: "lines", value: 750, ceiling: THRESHOLDS.lines.ceiling },
      { measure: "files", value: 25, ceiling: THRESHOLDS.files.ceiling },
      {
        measure: "codeAreas",
        value: 25,
        ceiling: THRESHOLDS.codeAreas.ceiling,
      },
    ])
  })

  it("names a commit that straddles two code areas", () => {
    const report = summarize(
      "origin/main",
      files([
        ["apps/web/src/a.tsx", 5, "M"],
        ["libs/dates/src/b.ts", 5, "M"],
      ]),
      [
        {
          sha: "abc1234567890",
          subject: "Do two things",
          paths: ["apps/web/src/a.tsx", "libs/dates/src/b.ts"],
        },
      ],
    )
    assert.deepEqual(report.straddlingCommits, [
      {
        sha: "abc1234567",
        subject: "Do two things",
        areas: ["apps/web", "libs/dates"],
      },
    ])
    assert.ok(
      report.concernSignals.includes(
        "1 commit(s) straddle more than one code area",
      ),
    )
  })

  it("does not call a commit straddling when the second area is only an excluded file", () => {
    const report = summarize(
      "origin/main",
      files([["apps/web/src/a.tsx", 5, "M"]]),
      [
        {
          sha: "abc1234567890",
          subject: "One thing",
          paths: ["apps/web/src/a.tsx", "pnpm-lock.yaml"],
        },
      ],
    )
    assert.deepEqual(report.straddlingCommits, [])
  })
})
