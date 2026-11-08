export const meta = {
  name: "maestro-review",
  description:
    "Review a pull request against the team's own blueprints — the single source of the review's passes, engines and criteria injection",
  whenToUse:
    "Every maestro review runs through this script; the /maestro:maestro review skill is a front door onto it. Pass args.pluginRoot, the absolute path of the plugin, args.blueprintMap, the absolute path of the map, and args.store, with args.trackerInstructions for a tracker or args.workDir for files. `node <pluginRoot>/scripts/config.mjs` prints all of them. Call it as a phase of larger work with workflow('maestro:maestro-review', { pluginRoot, scope, base, effort }), or launch it directly. Subagents cannot nest, so an agent that has neither the Workflow tool nor the Agent tool must hand the review back to its caller instead of reviewing in one context. Never resume a run: a failed pass has no cached result, so a resume re-runs it and every agent after it.",
  phases: [
    {
      title: "Route",
      detail:
        "one pass decides if a person must read the change, and which surface must know about it, against the review risk rules",
      model: "sonnet",
    },
    {
      title: "Scope",
      detail:
        "bucket the changed files by the surfaces of the blueprint map and pick the passes",
      model: "sonnet",
    },
    {
      title: "Review",
      detail:
        "only the passes the diff gives work to: two reasoning engines, one checklist pass per touched surface, a design pass where a surface asks for one, and the spec pass when a task reference resolves",
    },
    {
      title: "Verify",
      detail: "one pass adversarially refutes the most severe findings",
      model: "opus",
    },
    {
      title: "Synthesize",
      detail: "one Maestro Review report, grouped by severity",
      model: "sonnet",
    },
  ],
};

const scopeArg = typeof args === "string" ? { scope: args } : args || {};

// A workflow script cannot read files, and its agents run in the consumer's repository, so every
// path into the plugin is built from the absolute root the caller passes.
if (!scopeArg.pluginRoot) {
  throw new Error(
    "maestro-review: args.pluginRoot is missing. Pass the absolute path of the maestro plugin (${CLAUDE_PLUGIN_ROOT}), or use the args that `local.mjs prepare` printed. Without it no pass can read its method, so no review ran.",
  );
}
const PLUGIN_ROOT = scopeArg.pluginRoot.replace(/\/+$/, "");
const METHOD = `${PLUGIN_ROOT}/skills/maestro/review/references/method.md`;
const REVIEW_RISK = `${PLUGIN_ROOT}/skills/maestro/references/review-risk.md`;
const PR_SHAPE = `${PLUGIN_ROOT}/skills/maestro/references/pr-shape.md`;
const PR_SHAPE_SCRIPT = `${PLUGIN_ROOT}/scripts/pr-shape/report.mjs`;
const RATIO_SCRIPT = `${PLUGIN_ROOT}/scripts/comment-sweep/ratio.mjs`;

// The config can live outside the repository, so the caller resolves the map's path.
const MAP_PLACE = scopeArg.blueprintMap
  ? `It is at \`${scopeArg.blueprintMap}\`.`
  : `Run \`node ${PLUGIN_ROOT}/scripts/config.mjs\` and take its \`blueprintMap\` field, an absolute path.`;
const MAP_LOOKUP = `The blueprint map ties paths to the team's blueprints. ${MAP_PLACE} Every \`blueprint\`, \`reviewRisk\` and \`designReview\` path in it is relative to the map's own folder, so resolve each one against that folder before you read it. When the map does not exist, the repository has no blueprints, which is a normal outcome and not a failure.`;

const MAX_VERIFICATIONS = 20;

const CHEAP_MODEL = "sonnet";
const STRONG_MODEL = "opus";

// The caller reads `baseBranch` from the config, because a script cannot read files.
const base = scopeArg.base || `origin/${scopeArg.baseBranch || "main"}`;
const prBase = scopeArg.prBase || base;
// The store holds the task and spec artifacts; pull requests stay on GitHub either way. The caller
// reads `store` and `tracker.instructions` from the config.
const STORE = scopeArg.store || "github";
if (!["github", "tracker", "files"].includes(STORE)) {
  throw new Error(
    `maestro-review: args.store is "${STORE}", and it must be "github", "tracker" or "files". Fix \`store\` in the Maestro config. No review ran.`,
  );
}
const TRACKER_INSTRUCTIONS = (scopeArg.trackerInstructions || "").trim();
// With the files store, the task and spec files sit in this folder, often outside the repository.
const WORK_DIR = (scopeArg.workDir || "").replace(/\/+$/, "");
// A re-check reads only the changes since the last reviewed head.
const isRecheck = scopeArg.recheck === true;
const raisedFindingsPath = scopeArg.raisedFindings;

// The harness inherits the session effort (usually xhigh) when none is given, so every tier is explicit.
// An effort label does less work on newer models than on the ones these tiers were first set for, so
// each level sits one step above its first calibration, and `medium` reads as much code as the old
// default did. `low` keeps the exact tiers `medium` had before, for anyone who wants that faster review.
// `verification` never drops below high, whatever the level. The refutation pass decides which
// findings survive, and its prompt tells it to refute whatever it cannot demonstrate, so a weaker
// verifier does not judge less well — it judges against. Measured once on identical finder output:
// 7 findings confirmed with the verifier at high and 0 with it at medium. Lower the finders to save
// tokens, never this below high.
const EFFORT_LEVELS = {
  low: {
    mechanical: "low",
    checklist: "medium",
    reasoning: "medium",
    verification: "high",
  },
  medium: {
    mechanical: "low",
    checklist: "high",
    reasoning: "high",
    verification: "xhigh",
  },
  high: {
    mechanical: "low",
    checklist: "high",
    reasoning: "xhigh",
    verification: "xhigh",
  },
  max: {
    mechanical: "medium",
    checklist: "xhigh",
    reasoning: "xhigh",
    verification: "max",
  },
};
const DEFAULT_EFFORT = "medium";
const effortName = scopeArg.effort || DEFAULT_EFFORT;
const EFFORT = EFFORT_LEVELS[effortName] || EFFORT_LEVELS[DEFAULT_EFFORT];
if (!EFFORT_LEVELS[effortName])
  log(
    `Unknown effort "${effortName}" — running at ${DEFAULT_EFFORT}. Valid levels: ${Object.keys(EFFORT_LEVELS).join(", ")}.`,
  );

const narrowing = scopeArg.scope
  ? `Narrow the scope to these paths or aspects only: ${scopeArg.scope}.`
  : "Review the whole working diff.";
const fetchStep = base.startsWith("origin/")
  ? `Fetch first: \`${base}\` is only as fresh as the last fetch, and a stale ref puts already-merged upstream commits into the review scope.
  git fetch -q origin ${base.slice("origin/".length)}
`
  : "";

const SCOPE_SCHEMA = {
  type: "object",
  properties: {
    isEmpty: { type: "boolean" },
    blueprintMap: {
      type: "string",
      description:
        "the absolute path of the blueprint map you read, or an empty string when none exists",
    },
    surfaces: {
      type: "array",
      description:
        "one entry per surface of the map that at least one changed file matches",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "the surface id, as in the map" },
          blueprint: {
            type: "string",
            description: "the surface's blueprint path, resolved against the map's folder",
          },
          designReview: {
            type: "string",
            description:
              "the surface's designReview path, resolved against the map's folder, or an empty string when the map sets none",
          },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["id", "blueprint", "designReview", "files"],
      },
    },
    other: {
      type: "array",
      items: { type: "string" },
      description: "every changed file that no surface matches",
    },
    areTestsChanged: { type: "boolean" },
    areNewTypesAdded: { type: "boolean" },
    taskRefs: {
      type: "array",
      items: { type: "string" },
      description:
        "every task reference the pull request carries, as the store writes it: #12 on GitHub, ENG-123 on a tracker",
    },
    diffSummary: { type: "string" },
  },
  required: [
    "isEmpty",
    "blueprintMap",
    "surfaces",
    "other",
    "areTestsChanged",
    "areNewTypesAdded",
    "taskRefs",
    "diffSummary",
  ],
};

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "repo-relative path, never absolute",
          },
          line: { type: "number" },
          severity: {
            type: "string",
            enum: ["blocking", "should-fix", "suggestion"],
          },
          summary: { type: "string" },
          authority: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["file", "severity", "summary", "authority", "evidence"],
      },
    },
    looksGood: { type: "array", items: { type: "string" } },
    unreadFiles: {
      type: "array",
      items: { type: "string" },
      description:
        "every file this prompt told you to read that you could not open, with the path as written; empty when you read them all",
    },
  },
  required: ["findings", "looksGood", "unreadFiles"],
};

// One pass carries the pull request shape verdict, so it alone gets the extra field.
// The verdict is not a finding: it never enters the dedup, the refutation pass or the severity groups.
const SHAPE_SCHEMA = {
  type: "object",
  properties: {
    ...FINDINGS_SCHEMA.properties,
    prShape: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["ship", "split"] },
        headline: {
          type: "string",
          description:
            "the size in one line, from the script's own counts, never recomputed",
        },
        reasoning: { type: "string" },
        split: {
          type: "string",
          description:
            "on a split verdict: which concern each pull request carries, the order, and the named strategy",
        },
      },
      required: ["verdict", "headline", "reasoning"],
    },
  },
  required: [...FINDINGS_SCHEMA.required, "prShape"],
};

// The spec pass reports a contradiction as a verdict and never as a finding: a contradiction has
// no file and no line, and the refutation pass judges code rather than prose.
const SPEC_SCHEMA = {
  type: "object",
  properties: {
    ...FINDINGS_SCHEMA.properties,
    specCheck: {
      type: "object",
      properties: {
        ran: {
          type: "boolean",
          description:
            "false when the branch resolves to no requirement, or the store cannot be read",
        },
        specRef: {
          type: "string",
          description: "the reference of the spec read, as the store writes it",
        },
        requirementIds: {
          type: "array",
          items: { type: "string" },
          description:
            "every requirement read, named even when nothing was found",
        },
        contradictions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              requirement: { type: "string" },
              claim: {
                type: "string",
                description: "what the requirement says, quoted",
              },
              diffSays: { type: "string" },
              suggestedWording: { type: "string" },
            },
            required: ["requirement", "claim", "diffSays"],
          },
        },
        note: { type: "string" },
      },
      required: ["ran", "requirementIds", "contradictions"],
    },
  },
  required: [...FINDINGS_SCHEMA.required, "specCheck"],
};

const HUMAN_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    isNeeded: {
      type: "boolean",
      description: "true when at least one reason has the level review",
    },
    summary: {
      type: "string",
      description: "one sentence: why a person must read it, or why not",
    },
    reasons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "repo-relative path, never absolute",
          },
          rule: {
            type: "string",
            description:
              "the rule that fired, as `rule <n>`, `<surface> rule <n>`, `<surface> area: <name>` or `well-scoped change`",
          },
          level: {
            type: "string",
            enum: ["review", "aware"],
            description:
              "review: a person of the surface's team must read the change. aware: the team must only know about it",
          },
          why: { type: "string", description: "one sentence from the diff" },
        },
        required: ["file", "rule", "level", "why"],
      },
    },
    unreadFiles: { type: "array", items: { type: "string" } },
  },
  required: ["isNeeded", "summary", "reasons", "unreadFiles"],
};

const VERDICTS_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          file: {
            type: "string",
            description:
              "the file of the finding this verdict answers, copied verbatim",
          },
          isReal: { type: "boolean" },
          reason: { type: "string" },
          correctedSeverity: {
            type: "string",
            enum: ["blocking", "should-fix", "suggestion"],
          },
        },
        required: ["index", "file", "isReal", "reason"],
      },
    },
  },
  required: ["verdicts"],
};

// A pass that read the files has something to say on one list or the other; empty on both is a dead pass.
// Two passes are the exception, because a verdict proves the pass read the diff: one pass carries
// the shape verdict, and the spec pass carries the requirements it read. A clean result from either is
// a pass that worked, and not one to relaunch. A pass that names an unread file is kept as it is, because
// a relaunch cannot create the file.
const reviewOrNull = (r) =>
  Array.isArray(r?.findings) &&
  Array.isArray(r?.looksGood) &&
  (r.findings.length + r.looksGood.length > 0 ||
    Boolean(r.prShape?.verdict) ||
    Boolean(r.specCheck) ||
    r.unreadFiles?.length > 0)
    ? r
    : null;

// agent() retries transient errors itself and returns null only on a terminal failure, so one relaunch
// replaces the resume that re-ran the whole review. `run` gets the attempt number, so a pass can change
// one thing on its second launch.
const withOneRetry = async (label, run) => {
  const attempt = async (n) => {
    try {
      return await run(n);
    } catch (error) {
      log(`${label}: ${error?.message || error}`);
      return null;
    }
  };
  const first = await attempt(0);
  if (first) return first;
  log(`${label}: returned nothing, launching it once more.`);
  return attempt(1);
};

// Routing runs first, before any finding exists. It reads the whole pull request, because a
// re-check of the latest commits must not clear a surface.
const prFetch = prBase.startsWith("origin/")
  ? `git fetch -q origin ${prBase.slice("origin/".length)}; `
  : "";

let humanReview = null;
let routeFailure = null;
phase("Route");
const routed = await withOneRetry("route:human-review", () =>
  agent(
    `You are the first pass of a maestro code review. You read the whole pull request.

**Get the diff of the whole pull request in one call, with this exact command:**

\`\`\`bash
${prFetch}git diff ${prBase}...HEAD; git diff HEAD; echo '=== NEW FILES — no diff shows these, read each in full ==='; git ls-files --others --exclude-standard
\`\`\`

Report every path repo-relative, never absolute, except a blueprint file that sits outside the repository. **If a file this prompt tells you to read does not exist, put its path in \`unreadFiles\`.** A blueprint map that does not exist is not an unread file.

Your pass is **the routing decision**. You answer two questions: **must a person read this change before it merges, and must a team know about it?** You do not review the code. You do not pick a team: the step that posts the review picks it from the map, from the files you name.

**Read \`${REVIEW_RISK}\` first, in full.** It holds the rules of every surface, the two levels, and how to write the decision. Then find the blueprint map. ${MAP_LOOKUP} When it exists, find for each changed file the surfaces whose \`paths\` match it, and read the \`reviewRisk\` file of each one. Read each file once. A \`reviewRisk\` path that the map names and that does not exist goes in \`unreadFiles\`.

The pull request shape counts under the rules. Measure it: run \`node ${PR_SHAPE_SCRIPT} ${prBase} --json\`, read \`${PR_SHAPE}\`, and count \`split\` only when the report shows a concern signal or a split you can name.

Give one entry in \`reasons\` for each file and rule that fired. Its \`level\` is \`review\` when the change is dangerous or changes the architecture, as a rule or a risky area says, and \`aware\` when the change is well-scoped, as the file defines. Rule 15 is not yours: no finding exists yet, and it applies after the review. A reason with no rule is not a reason. Set \`isNeeded\` to true when at least one reason has the level \`review\`. When no rule fires, set \`isNeeded\` to false, leave \`reasons\` empty, and say why in \`summary\`.`,
    {
      label: "route:human-review",
      phase: "Route",
      schema: HUMAN_REVIEW_SCHEMA,
      model: CHEAP_MODEL,
      effort: EFFORT.checklist,
    },
  ),
);
humanReview =
  routed && !(routed.unreadFiles?.length > 0)
    ? {
        isNeeded: routed.isNeeded,
        summary: routed.summary,
        reasons: routed.reasons,
      }
    : null;
if (!humanReview) {
  routeFailure = routed?.unreadFiles?.length
    ? `the route pass could not read ${routed.unreadFiles.join(", ")}`
    : "the route pass gave no result, twice";
  log(`No human review decision — ${routeFailure}. The report must say so.`);
}

phase("Scope");

// The store's **link PR** rule says how a pull request names its task.
const taskRefsRule =
  STORE === "github"
    ? "taskRefs: the issues the pull request closes, each written as `#<n>`. Run `gh pr view --json closingIssuesReferences,body` and take them from `closingIssuesReferences`, or from the `Closes #<n>` lines of the body when that list is empty, because GitHub links them a few minutes late. Give an empty list when the branch has no pull request, or when its body has no such line."
    : STORE === "files"
      ? "taskRefs: every reference on a `Maestro-Task: <ref>` line of the pull request body, written as it is there (such as `export-csv#3`). Run `gh pr view --json body`. Give an empty list when the branch has no pull request, or when its body has no such line."
      : `taskRefs: every task reference the pull request carries, by the tracker's link PR rule, each written as the tracker writes it (such as \`ENG-123\`). Run \`gh pr view --json body,headRefName\` and \`git rev-parse --abbrev-ref HEAD\`. Take each reference from the lines of the body that the rule names, and from the branch name when it carries one: \`eng-123-add-banner\` gives \`ENG-123\`. ${TRACKER_INSTRUCTIONS ? `The tracker instructions state the rule:\n\n${TRACKER_INSTRUCTIONS}\n` : "No tracker instructions were given, so take references of the form `ABC-123` from the `Fixes`, `Closes` and `Resolves` lines of the body and from the branch name."} Do not call the tracker: read only the pull request and the branch. Give an empty list when neither carries a reference.`;

const scope = await withOneRetry("scope:diff", () =>
  agent(
    `You are scoping a code review of the working diff in this repository.

Run these and read the result.
${fetchStep}  git diff --name-only ${base}...HEAD
  git diff --name-only
  git diff --name-only --staged
  git ls-files --others --exclude-standard

The last one matters: no \`git diff\` form lists a new file that was never staged, and an unreviewed new file is the worst thing this review can miss.

${narrowing}

Then bucket every changed file by the surfaces of the blueprint map, using repo-relative paths. ${MAP_LOOKUP} Set \`blueprintMap\` to the path you read, or to an empty string when there is none.

The map holds a \`surfaces\` list. Each surface has an \`id\`, a \`blueprint\`, an optional \`designReview\`, and a \`paths\` list. A path entry matches a path segment anywhere in the file path, so \`docs/\` matches \`docs/a.md\` and \`site/docs/a.md\`. A surface with \`rootOnly: true\` matches only at the repository root. A \`*\` matches within one segment, so \`*.ts\` matches every TypeScript file and \`services/*/\` matches every service. **A file can match more than one surface: list it under each.** Give one entry in \`surfaces\` for each surface that at least one changed file matches, with its \`id\`, \`blueprint\` and \`designReview\` copied from the map (an empty string when the map sets no \`designReview\`) and its matching files. Skip a surface with an empty \`paths\` list. Put every file that no surface matches in \`other\`. With no map, \`surfaces\` is empty and every file goes in \`other\`. Never invent a surface the map does not name.

Also report whether any test file changed (areTestsChanged) and whether the diff adds new exported types, interfaces or enums (areNewTypesAdded) — check the diff content for these two, not just filenames.

${taskRefsRule}

diffSummary: two or three sentences on what the diff does, for the reviewers downstream. Do not review anything yourself.
isEmpty: true only when there is no changed file at all in scope.`,
    {
      label: "scope:diff",
      phase: "Scope",
      schema: SCOPE_SCHEMA,
      model: CHEAP_MODEL,
      effort: EFFORT.mechanical,
    },
  ),
);

if (!scope) {
  throw new Error(
    "maestro-review: the scoping agent returned nothing twice, so no pass ran. This is a failed review, not a clean one — launch a fresh review, never a resume.",
  );
}

const emptyResult = (report) => ({
  report,
  humanReview,
  findings: [],
  confirmedCount: 0,
  refutedCount: 0,
  unverifiedCount: 0,
  passes: [],
  failedPasses: [],
});

if (scope.isEmpty) {
  log("Diff is empty in scope — nothing to review.");
  return emptyResult("Maestro Review — no changes in scope.");
}

// A pass starts only when the diff holds files it reviews, and it reads only those files.
const isDocument = (path) =>
  /(^|\/)(README|CHANGELOG)[^/]*\.mdx?$/i.test(path) ||
  path.startsWith("docs/") ||
  /\.txt$/i.test(path);
const isGenerated = (path) =>
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(path) ||
  /(^|\/)[^/]*generated[^/]*\//i.test(path);
const isSourceCode = (path) => /\.([cm]?[jt]sx?|py|sh|sql|prisma)$/.test(path);
const isTest = (path) =>
  /\.(test|spec|stories|eval)(\.browser)?\.[cm]?[jt]sx?$/.test(path) ||
  /(^|\/)__tests__\//.test(path);

const reviewable = (files) => files.filter((f) => !isGenerated(f));
const hasBlueprints = Boolean(scope.blueprintMap);
const surfaces = (scope.surfaces || [])
  .map((s) => ({ ...s, files: reviewable(s.files || []) }))
  .filter((s) => s.files.length > 0);
const otherFiles = reviewable(scope.other || []);

const changedFiles = [
  ...new Set([
    ...(scope.surfaces || []).flatMap((s) => s.files || []),
    ...(scope.other || []),
  ]),
];
const generatedFiles = changedFiles.filter(isGenerated);
const allFiles = reviewable(changedFiles);

if (allFiles.length === 0) {
  log(`Only generated files changed: ${generatedFiles.join(", ")}.`);
  return emptyResult(
    `Maestro Review — only generated files changed (${generatedFiles.join(", ")}), so no pass ran.`,
  );
}
if (!hasBlueprints)
  log(
    "No blueprint map found — every pass runs on the generic method only. The report must say so.",
  );

const documents = allFiles.filter(isDocument);
const behaviourFiles = allFiles.filter((f) => !isDocument(f));
const codeFiles = allFiles.filter(isSourceCode);
const hasSourceCode = codeFiles.some((f) => !isTest(f));

// A file can sit on several surfaces. The folded criteria run once per file, in the first pass that holds it.
const foldedHome = new Map();
for (const s of surfaces)
  for (const f of s.files) if (!foldedHome.has(f)) foldedHome.set(f, s.id);
for (const f of otherFiles) if (!foldedHome.has(f)) foldedHome.set(f, "");

const quote = (path) => `'${path.replaceAll("'", "'\\''")}'`;

// A re-check that fell back to the whole pull request gets the earlier findings without the re-check rules.
const earlierFindingsRule = raisedFindingsPath
  ? `
- Do not report an earlier finding again, in other words or not. \`${raisedFindingsPath}\` lists each earlier finding. \`isResolved\` is true when the code fixed it or a person justified it. Another step judges each earlier finding.`
  : "";

const recheckRule = isRecheck
  ? `

**This review is a re-check.** An earlier review read the whole pull request. The diff command below gives only the changes since that review, and most of them are fixes for its findings. Review these changes, and not the pull request again:
- Report a defect only when these changes introduce it. A problem that was there before them is not a finding, even on a line that they touch.
- Report no suggestion. A re-check reports only blocking and should-fix findings, so that the loop of fixes and re-checks ends.${earlierFindingsRule}`
  : earlierFindingsRule
    ? `

**An earlier review raised findings on this pull request.**${earlierFindingsRule}`
    : "";

const authorities = hasBlueprints
  ? `The authorities are the team's blueprints, which the map at \`${scope.blueprintMap}\` ties to paths, then the repository's own instructions files (\`CLAUDE.md\`, \`AGENTS.md\`, \`CONTRIBUTING.md\`, when present), then the actual code.`
  : "This repository has no blueprint map, so no blueprint applies. The authorities are the repository's own instructions files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, when present), then the actual code.";

const preambleFor = (files) => {
  const paths = files.map(quote).join(" ");
  return `You are one pass of a maestro code review.${scopeArg.scope ? ` ${narrowing}` : ""}${recheckRule}

**Get the diff of your files in one call, with this exact command:**

\`\`\`bash
git diff ${base}...HEAD -- ${paths}; git diff HEAD -- ${paths}; echo '=== NEW FILES — no diff shows these, read each in full ==='; git ls-files --others --exclude-standard -- ${paths}
\`\`\`

These are the changed files this pass reviews. Read any other file you need for context, the callers of the changed code included. Do not re-derive the diff with a \`git diff -- <path>\` per file, and do not fetch it per directory: each call is a round trip that re-sends everything you have read so far.

What the whole diff does: ${scope.diffSummary}

**Read \`${METHOD}\` before you review.** It holds the review's own method: how to cite an authority, the comment measurement, the security leads, and what not to flag. ${authorities} Read the "What NOT to flag" section and obey it — do not raise anything a linter, typechecker, formatter or CI would catch, and do not raise pre-existing issues on unmodified lines.

Cite the authority for every finding (a blueprint rule, an instructions-file rule, or the code itself). A finding with no authority and no concrete evidence is not a finding. Report every path repo-relative, never absolute, except a blueprint you cite that sits outside the repository.

**If a file this prompt tells you to read does not exist, put its path in \`unreadFiles\`.** Do not review from memory in its place. The script then reports your pass as one that did not run, which is true: a pass without its method file is not the review it claims to be.`;
};

const shapeCheck = `**You also carry one process check: the pull request shape check.** Nothing else about process belongs in this review. It runs in one pass because it asks about the whole branch once, and a branch that needs splitting is cheapest to split before anybody reviews it.

Run the script, and read the whole report:

\`\`\`bash
node ${PR_SHAPE_SCRIPT} ${base} --json
\`\`\`

**The script counts committed history, and this review covers the working diff.** The script diffs \`${base}...HEAD\`, so a staged, unstaged or untracked change is reviewed by you and counted by nothing. Run \`git status --porcelain\` before you read the numbers. When the tree is dirty, say so in \`headline\` beside the counts rather than presenting a figure the branch has already outgrown, and judge the tangle on everything you read, committed or not.

**The script holds the numbers, and you judge the tangle.** Report no number it did not produce, and restate no threshold of your own: \`${PR_SHAPE}\` explains what each field means, and the script has already compared the branch against the thresholds. Read that file. Your judgement is the part a threshold cannot reach — could one half merge and deploy on its own, is this a vertical slice or a horizontal one, does any commit mix a refactor with a behavior change, do the domains belong to one story. \`breaches\` says the branch is large and \`concernSignals\` says it carries more than one thing: a small branch with a concern signal still splits, and a large one with none can be a single coherent slice.

**Return the verdict in \`prShape\`, and never as a finding.** It is reported apart from your findings, it goes through no refutation pass, and a shape observation filed as a finding would be counted as a bug in the code. Give \`verdict\` as \`ship\` or \`split\`, \`headline\` as the size in one line from the script's own counts, and \`reasoning\` in two or three sentences. On \`split\`, \`split\` says which concern each pull request carries, in which order, and names the strategy from the reference. Do not pad a clean verdict, and never stop at "this is too large" without giving the split.`;

const foldedFor = (homeId, files) => {
  const own = files.filter((f) => foldedHome.get(f) === homeId);
  if (own.length === 0) return "";
  const criteria = [
    `- **A guard that the diff adds or changes.** A guard is a test or a script that reads the tree and passes when it finds no fault. Report a guard when no test gives it one case it must reject, on input that the test owns. The authority is the "Guards" section of \`${METHOD}\`.`,
    `- **Comments**, governed by the "Comments" section of \`${METHOD}\`. Report every comment or JSDoc block the diff adds or modifies that should go or be corrected, and every comment of a changed file that the diff made false, even on a line the diff never touched. Never report a missing comment or docstring. Measure the ratio with \`node ${RATIO_SCRIPT} ${base} -- <these files>\`, which counts the comment and code lines that the diff adds, non-blank and tests excluded: put the ratio in \`looksGood\` when it is healthy, and raise it when it is above roughly one third, or when a new file has more comment lines than code lines.`,
  ];
  if (scope.areTestsChanged)
    criteria.push(
      `- **Test coverage** of the changed behaviour. A dedicated test for a trivial function that an integration test already covers is not a gap, so weigh whether a gap is real before raising it.`,
    );
  if (scope.areNewTypesAdded)
    criteria.push(
      `- **Type design** for the types the diff adds: encapsulation, and invariants the type expresses rather than documents. Apply the type rules of the blueprint and the instructions files when they state any.`,
    );
  return `

Fold these into the same pass, as part of your own review rather than as separate sections. They apply to these files of your list only, because another pass folds them into the rest:
${own.map((f) => `- ${f}`).join("\n")}

${criteria.join("\n")}`;
};

const documentRule = (files) =>
  files.some(isDocument)
    ? " Check that every claim a document makes about the repository, such as a file, a command, a symbol or a behaviour, is still true."
    : "";

const listFiles = (files) => files.map((f) => `- ${f}`).join("\n");

const passes = [];

if (behaviourFiles.length > 0) {
  passes.push({
    key: "correctness",
    engine: "pr-review-toolkit:code-reviewer",
    model: STRONG_MODEL,
    effort: EFFORT.reasoning,
    prompt: `${preambleFor(behaviourFiles)}

Your pass is **correctness**: real bugs, broken logic, wrong control flow, unhandled states, races, incorrect data access. This is the bug-finding pass — the convention passes are handled by other reviewers, so stay on correctness and do not report style or naming.`,
  });
}

if (hasSourceCode) {
  const errorRules = surfaces.length
    ? ` Judge logging and error handling against the error-handling rules of these blueprints, when they state any: ${surfaces.map((s) => `\`${s.blueprint}\``).join(", ")}. Without a rule, the convention is the one the surrounding code already follows.`
    : " Judge logging and error handling against the convention the surrounding code already follows.";
  passes.push({
    key: "error-handling",
    engine: "pr-review-toolkit:silent-failure-hunter",
    model: STRONG_MODEL,
    effort: EFFORT.reasoning,
    prompt: `${preambleFor(codeFiles)}

Your pass is **error handling**: silent failures, empty or over-broad catches, fallbacks that swallow a real error.

**A \`catch\` block is not the only form a silent failure takes.** Read every failure path the diff adds. Then read every older failure path that a new fault of the diff now reaches, such as a new timeout that ends in an old \`.catch(() => [])\`. The old line is unmodified, and the diff still made it reachable, so it is a finding. Hunt these three as well:

1. **A return that substitutes a plausible answer.** A function that cannot compute its result must fail. A zero, an empty list, \`undefined\` or the happy-path value each read as a real answer, so the caller cannot tell the two apart. A default is correct only when the caller can. An exit code hides this: \`lsof\` and \`git grep\` exit 1 both when nothing matches and when they fail.
2. **A branch that covers a handled outcome and a fault together.** The fault gets its own message, at \`error\`. One shared \`warn\` over the two hides it.
3. **A second handler that reports less than the first.** For each error type the diff handles, find the other handlers of that type, in the same file and in its siblings. Compare what each one reports. A new handler that drops the position, the id or the cause its sibling adds makes a fault in our own code look like ordinary bad input. Read the handlers together: each one on its own reads as correct.

**Your stock conventions may name tools this repository does not have**, such as an \`errorIds.ts\` file, a Sentry \`logError\`, a \`logForDebugging\` or a Statsig \`logEvent\`. Search for one before you cite it, and never ask for one the repository does not use.${errorRules}`,
  });
}

for (const s of surfaces) {
  passes.push({
    key: `surface:${s.id}`,
    model: STRONG_MODEL,
    effort: EFFORT.checklist,
    prompt: `${preambleFor(s.files)}

Your pass is **the \`${s.id}\` surface**, over these changed files:
${listFiles(s.files)}

**Read \`${s.blueprint}\` first, in full** — it is the authority for these files, and you must review against its rules and traps rather than against generic advice. Load another file it names only when a rule sends you there. A file of your list that matches another surface too gets that surface's pass as well, so stay on this blueprint.${documentRule(s.files)}${foldedFor(s.id, s.files)}`,
  });

  // Its own context, so that the line checks and the folded criteria of the surface pass do not crowd design out.
  if (s.designReview) {
    const designFiles = s.files.filter((f) => !isDocument(f));
    if (designFiles.length > 0)
      passes.push({
        key: `design:${s.id}`,
        model: STRONG_MODEL,
        effort: EFFORT.reasoning,
        prompt: `${preambleFor(designFiles)}

Your pass is **design** on the \`${s.id}\` surface, over these changed files:
${listFiles(designFiles)}

You review as the owner of this surface's blueprint. The owner asks one question of each new piece of code: is it in its home, and does it follow the accepted way? The \`${s.id}\` pass checks each line against the rules. You check where the code sits and how it is built.

**Read these in full before you review:** \`${s.blueprint}\`, then \`${s.designReview}\`, which is this surface's design guide. Read every file the design guide tells you to read. The "Design" section of \`${METHOD}\` holds the generic lessons that apply on any surface.

Do these three steps for each class, function, module, interface and handler that the diff adds or moves to a new file:
1. Find its home in the blueprint or the design guide. Check that it sits there.
2. Find its precedent. A precedent is an existing file that does the same thing and follows the blueprint. Look in the same module first, then across the surface. Open it, and compare the names, the construction, the events it emits, the order of its checks, and the return type. A neighbour that breaks the blueprint is not a precedent.
3. Check that each new name carries one concept, and that a new interface does not repeat an interface for the same concept.

**Every finding cites two things:** the rule it breaks, and the precedent as \`path:line\`. If no rule exists, the precedent alone is the authority, and the severity is suggestion. A finding with neither is an opinion, so do not report it.

A breach of a rule that holds a layer or a boundary is at least should-fix. An owner does not accept a breach of one as a follow-up. The design guide names those rules when the blueprint does not.

Stay on design. Comments, test coverage, type style, correctness and logging belong to other passes. One exception: a test that calls a helper exported only for that test, or that reads the text of a prompt or a content file, is a design finding.`,
      });
  }
}

if (otherFiles.length > 0) {
  passes.push({
    key: "conventions",
    model: STRONG_MODEL,
    effort: EFFORT.checklist,
    prompt: `${preambleFor(otherFiles)}

Your pass is **repo conventions**, over these changed files:
${listFiles(otherFiles)}

${hasBlueprints ? "No surface of the blueprint map covers them" : "The repository has no blueprint map"}, so apply \`${METHOD}\` as a whole, then the rules of the repository's own instructions files, then the conventions the surrounding code already follows.${documentRule(otherFiles)}${foldedFor("", otherFiles)}`,
  });
}

// The spec pass needs a task reference, and on a tracker it needs the instructions that name the MCP.
const specSkip =
  scope.taskRefs.length === 0
    ? {
        short: "the scope step resolved no task reference",
        note:
          STORE === "github"
            ? "The scope step resolved no task reference: the branch has no pull request, or its body has no `Closes #<n>` line. The spec pass did not start."
            : STORE === "files"
              ? "The scope step resolved no task reference: the pull request body has no `Maestro-Task:` line. The spec pass did not start."
              : "The scope step resolved no task reference: neither the pull request body nor the branch name carries one by the tracker's link PR rule. The spec pass did not start.",
      }
    : STORE === "files" && !WORK_DIR
      ? {
          short: "the store is files, and no work folder was given",
          note: `The store is files, and no args.workDir was given, so the spec pass cannot find ${scope.taskRefs.join(", ")}. Pass the workDir that scripts/config.mjs prints. The spec pass did not start.`,
        }
      : STORE === "tracker" && !TRACKER_INSTRUCTIONS
      ? {
          short: "the store is tracker, and no tracker instructions were given",
          note: `The store is tracker, and no tracker instructions were given, so the spec pass cannot tell which MCP holds ${scope.taskRefs.join(", ")} and its spec. Set \`tracker.instructions\` in the Maestro config. The spec pass did not start.`,
        }
      : null;

const specChain =
  STORE === "github"
    ? `The scope step found these task references: ${scope.taskRefs.join(", ")}. Resolve the branch to its requirements. The chain is mechanical, so do not guess at any step:

\`\`\`bash
gh pr view --json number,closingIssuesReferences,body
gh issue view <task> --json body,labels
gh issue view <spec> --json body
\`\`\`

**An empty \`closingIssuesReferences\` on a recent pull request means "not yet", and not "none".** GitHub does not create that link synchronously, and it can take several minutes. Before you conclude the branch resolves to nothing, read the pull request body yourself and take the \`Closes #<n>\` line from it. Only a body with no such line puts the branch outside the flow.

The pull request closes one or more task issues, which carry the \`maestro:task\` label. Each task issue names its spec and its requirement ids in the first line of its body, in its \`**Spec**\` and \`**Requirements**\` fields. Read the spec issue, and read **only those requirements**, including the acceptance criteria and the notes inside their \`<details>\` blocks.`
    : STORE === "files"
      ? `The scope step found these task references: ${scope.taskRefs.join(", ")}. The task and its spec are markdown files in \`${WORK_DIR}\`, and the pull request stays on GitHub. Resolve the branch to its requirements. The chain is mechanical, so do not guess at any step:

1. For each reference \`<project>#<n>\`, read the file \`${WORK_DIR}/<project>/<n>-*.md\`. Its frontmatter gives the kind, which must be \`task\`, and the \`parent\`.
2. Find its spec. The first line of the task body names it in its \`**Spec**\` field. When the body has no such field, take the spec from the \`parent\` reference, and read its file the same way.
3. Read the spec, and read **only the requirements** that the task names in its \`**Requirements**\` field, including the acceptance criteria and the notes inside their \`<details>\` blocks.

**Read only. Never write a file in that folder.**`
      : `The scope step found these task references: ${scope.taskRefs.join(", ")}. The task and its spec live in a tracker, and the pull request stays on GitHub. These tracker instructions say which MCP holds them and how each artifact maps:

${TRACKER_INSTRUCTIONS}

Resolve the branch to its requirements with that tracker's MCP tools. The chain is mechanical, so do not guess at any step:

1. Find the tools: run ToolSearch with the tracker's name from the instructions, and load the tools that read an issue, a document or a project.
2. Read each task: its title, body, status and parent.
3. Find its spec. The first line of the task body names it in its \`**Spec**\` field. When the body has no such field, take the spec from the parent link that the instructions name, such as a sub-issue of its spec, a parent relation, or a \`Parent: <ref>\` line in the body.
4. Read the spec, and read **only the requirements** that the task names in its \`**Requirements**\` field, including the acceptance criteria and the notes inside their \`<details>\` blocks.

**Read only. Never create, update or close anything in the tracker.**`;

const specUnresolved =
  STORE === "github"
    ? "no pull request yet, no `Closes` line, a closed issue without the `maestro:task` label, or a task issue that names none"
    : STORE === "files"
      ? "no `Maestro-Task:` line in the pull request body, a reference with no file in the work folder, a file whose kind is not task, a task with no spec, or a task that names no requirement"
      : "no tracker tool found because the tracker's MCP is not connected in this session, a reference the tracker does not know, a task with no spec, or a task that names no requirement";

if (!specSkip) {
  passes.push({
    key: "spec",
    model: CHEAP_MODEL,
    effort: EFFORT.checklist,
    schema: SPEC_SCHEMA,
    prompt: `${preambleFor(allFiles)}

Your pass is **the spec check**, and it is the only pass that reads outside the repository. You answer one question: **does this diff contradict a requirement it is supposed to satisfy?**

${specChain}

**A contradiction is a requirement the diff makes false**, not one it leaves unfinished. A criterion that is not yet met is ordinary work in progress and is never reported here. Report a requirement whose stated rule, formula, threshold, command or named behaviour the diff has changed, and a criterion that can no longer become true as written.

For each one, give the requirement id, the claim it makes quoted from the spec, what the diff does instead, and the wording you would propose. **Propose the wording. Never edit the task or the spec.** Set \`specRef\` to the reference of the spec you read.

**Set \`requirementIds\` to every requirement you read, even when you find nothing.** A report that found nothing and a check that never ran look identical otherwise, and the second one is worthless.

When the branch resolves to no requirement — ${specUnresolved} — set \`ran\` to false, say which step of the chain broke and why in \`note\`, and stop. That is a normal outcome for a branch outside the maestro flow, and not a failure.

Put nothing in \`findings\`. Your output is \`specCheck\`. Use \`looksGood\` for one line naming the requirements you read and the verdict.`,
  });
}

// Correctness carries the shape check whenever the diff holds a file that is not a document; the first other pass carries it on a diff of documents only.
const shapeCarrier = passes.find((p) => p.key !== "spec") || passes[0];
shapeCarrier.prompt = `${shapeCarrier.prompt}

${shapeCheck}`;
shapeCarrier.schema = SHAPE_SCHEMA;

const notStarted = [
  behaviourFiles.length === 0 &&
    "correctness (the diff changes only documents)",
  !hasSourceCode && "error-handling (the diff changes no source code)",
  specSkip && `spec (${specSkip.short})`,
].filter(Boolean);

log(
  `Reviewing ${allFiles.length} changed files (${codeFiles.length} source, ${documents.length} documents${generatedFiles.length > 0 ? `, ${generatedFiles.length} generated and skipped` : ""}) on ${surfaces.length} surfaces${hasBlueprints ? "" : " (no blueprint map)"} at ${effortName} effort with ${passes.length} passes: ${passes.map((p) => `${p.key} (${p.model || "session model"}, ${p.effort})`).join(", ")}${notStarted.length > 0 ? `. Not started: ${notStarted.join("; ")}` : ""}`,
);

phase("Review");

// The two reasoning engines come from the pr-review-toolkit plugin. When it is not installed, the
// relaunch runs the same prompt on the default agent, so a missing engine costs depth and not the pass.
const reviews = await parallel(
  passes.map(
    (p) => () =>
      withOneRetry(`review:${p.key}`, (n) =>
        agent(p.prompt, {
          label: `review:${p.key}`,
          phase: "Review",
          schema: p.schema || FINDINGS_SCHEMA,
          agentType: n === 0 ? p.engine : undefined,
          model: p.model,
          effort: p.effort,
        }).then(reviewOrNull),
      ).then((r) => (r ? { pass: p.key, ...r } : null)),
  ),
);

// A pass that could not open a file it was told to read reviewed without its authority, so it did not run.
const blind = reviews.filter((r) => r?.unreadFiles?.length > 0);
const ok = reviews.filter((r) => r && !blind.includes(r));
const failedPasses = passes
  .filter((p) => !ok.some((r) => r.pass === p.key))
  .map((p) => p.key);
const failures = failedPasses.map((key) => {
  const unread = blind.find((r) => r.pass === key)?.unreadFiles;
  return unread
    ? `${key} (it could not read ${unread.join(", ")})`
    : `${key} (it gave no result, twice)`;
});
if (failures.length > 0)
  log(
    `Passes that did not run: ${failures.join("; ")} — the report must say so.`,
  );
if (blind.length > 0)
  log(
    `A missing file usually means the blueprint map names a path that does not exist, or args.pluginRoot (${PLUGIN_ROOT}) is not the plugin's root.`,
  );
if (ok.length === 0) {
  throw new Error(
    `maestro-review: no review pass ran: ${failures.join("; ")}. This is a failed review, not a clean one — launch a fresh review, never a resume.`,
  );
}

// The verdict is reported apart from the findings, so it skips the dedup and the refutation pass below.
const prShape = ok.find((r) => r.prShape)?.prShape || null;
if (!prShape)
  log(
    "No pull request shape verdict — the first pass of the plan carries it, and it returned none. The report must say so.",
  );

const specCheck = specSkip
  ? {
      ran: false,
      requirementIds: [],
      contradictions: [],
      note: specSkip.note,
    }
  : ok.find((r) => r.pass === "spec")?.specCheck || null;
if (!specCheck)
  log(
    "No spec check — the pass carries it, and it returned none. The report must say so.",
  );

const seen = new Set();
const deduped = [];
for (const review of ok) {
  for (const f of review.findings || []) {
    const key = `${f.file}:${f.line ?? ""}:${f.summary.slice(0, 60).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...f, pass: review.pass });
  }
}

const severityRank = { blocking: 0, "should-fix": 1, suggestion: 2 };
deduped.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

// The prompt asks a re-check for no suggestion, and this holds it when a pass gives one anyway.
const isKept = (f) => !isRecheck || f.severity !== "suggestion";
const candidates = deduped.filter(isKept);
let droppedSuggestionCount = deduped.length - candidates.length;

const toVerify = candidates.slice(0, MAX_VERIFICATIONS);
const beyondCap = candidates
  .slice(MAX_VERIFICATIONS)
  .map((f) => ({ ...f, verification: "not-attempted" }));
if (beyondCap.length > 0) {
  log(
    `${candidates.length} findings, verifying the ${MAX_VERIFICATIONS} most severe; ${beyondCap.length} go to the report marked unverified.`,
  );
}

phase("Verify");

const verdicts =
  toVerify.length > 0
    ? await withOneRetry("verify:findings", () =>
        agent(
          `Try to **refute** each of these review findings by reading the actual code. Default to refuted when you are not sure — a finding that survives must be one you could demonstrate.

Get the diff under review in one call with \`git diff ${base}...HEAD; git diff HEAD; git ls-files --others --exclude-standard\`, then open the files each finding names and the surrounding code.

Findings (JSON). Each verdict must carry the same \`index\` and the same \`file\` as the finding it answers:
${JSON.stringify(
  toVerify.map((f, index) => ({
    index,
    file: f.file,
    line: f.line,
    severity: f.severity,
    claim: f.summary,
    authority: f.authority,
    evidence: f.evidence,
  })),
  null,
  2,
)}

Judge each one on its own:
- isReal: false if the claim is wrong, if it describes unmodified pre-existing code, if a linter/typechecker/CI would catch it, or if the cited authority does not actually say what the finding claims. Open the authority the finding cites — a blueprint, an instructions file, or \`${METHOD}\` — and check it: a misquoted rule refutes the finding.
- isReal: true only if you can point at the code that is wrong.
- correctedSeverity: the severity you would give it, which may be lower than claimed.
- reason: one or two sentences.${
            isRecheck
              ? `

This review is a re-check, and the diff holds only the changes since an earlier review. A finding is real only when these changes introduce the problem. Open the file at \`${base}\` with \`git show ${base}:<file>\`. If the problem is there too, set isReal to false.`
              : ""
          }

Return one verdict per finding. A finding you omit is treated as unverified, not as confirmed.`,
          {
            label: "verify:findings",
            phase: "Verify",
            schema: VERDICTS_SCHEMA,
            model: STRONG_MODEL,
            effort: EFFORT.verification,
          },
        ),
      )
    : { verdicts: [] };

// The index is a model-written join key, so a verdict counts only when its index and file both match one finding.
const verdictByIndex = new Map();
const ambiguous = new Set();
for (const v of verdicts?.verdicts || []) {
  const finding = toVerify[v.index];
  if (!finding || finding.file !== v.file) continue;
  if (verdictByIndex.has(v.index)) ambiguous.add(v.index);
  verdictByIndex.set(v.index, v);
}
for (const index of ambiguous) verdictByIndex.delete(index);

const confirmed = [];
const refuted = [];
const verificationFailures = [];
toVerify.forEach((f, i) => {
  const verdict = verdictByIndex.get(i);
  if (!verdict) {
    verificationFailures.push({ ...f, verification: "failed" });
    return;
  }
  if (verdict.isReal) {
    confirmed.push({
      ...f,
      severity: verdict.correctedSeverity || f.severity,
      verification: "confirmed",
      verificationReason: verdict.reason,
    });
    return;
  }
  refuted.push({
    ...f,
    verification: "refuted",
    verificationReason: verdict.reason,
  });
});

if (verificationFailures.length > 0) {
  log(
    `${verificationFailures.length} findings came back with no usable verdict — kept in the report, marked unverified.`,
  );
}
log(
  `${confirmed.length} findings confirmed, ${refuted.length} refuted and dropped.`,
);

// The refutation pass can lower a finding to a suggestion, so the re-check gate applies again.
const confirmedKept = confirmed.filter(isKept);
droppedSuggestionCount += confirmed.length - confirmedKept.length;
const reported = [...confirmedKept, ...verificationFailures, ...beyondCap];
if (droppedSuggestionCount > 0)
  log(
    `Re-check: ${droppedSuggestionCount} suggestions dropped, because a re-check reports only blocking and should-fix findings.`,
  );

phase("Synthesize");

const report = await withOneRetry("synthesize:report", () =>
  agent(
    `Write the final Maestro Review report from these findings. Do not re-review the code and do not add findings of your own.

Passes that ran: ${ok.map((r) => r.pass).join(", ")}${notStarted.length > 0 ? `\nPasses not started, because this diff gives them nothing to review: ${notStarted.join("; ")}. Name them in "What ran" with that reason, so that nobody reads them as failed.` : ""}${failures.length > 0 ? `\nPasses that did not run, so their part of the diff is unreviewed: ${failures.join("; ")}. Say this in the report in these words. Never write that such a pass "returned nothing" or "found nothing", because a reader takes that for a clean pass.` : ""}${hasBlueprints ? `\nSurfaces reviewed against their blueprint, from the map at \`${scope.blueprintMap}\`: ${surfaces.map((s) => s.id).join(", ") || "none — no changed file matched a surface"}.` : '\nNo blueprint map was found, so every pass ran on the generic method only. Say so in "What ran", and say that the team can add blueprints and a map to review against its own standards.'}
Findings confirmed by an independent refutation pass: ${confirmedKept.length}. Refuted and dropped: ${refuted.length}.${isRecheck ? `\nThis review is a re-check of the changes since the last review, and not a review of the whole pull request. Say so in the scope line. ${droppedSuggestionCount} suggestions were dropped, because a re-check reports only blocking and should-fix findings. Give this count in "What ran", and drop the Suggestions section.` : ""}
Findings carrying \`verification: "failed"\` came back with no usable verdict. Findings carrying \`verification: "not-attempted"\` are past the cap of ${MAX_VERIFICATIONS} verifications. Mark both groups **unverified** in the report, and say how many there are.

Findings (JSON):
${JSON.stringify(reported, null, 2)}

Pull request shape verdict (JSON), from the pass that carried it. ${prShape ? "It is a verdict and not a finding: render it in its own section, as prose, and never as a bullet under a severity group. Quote its `headline` and `reasoning` as they are, and never recompute a number." : 'The pass returned none, so write the section as "the shape check did not run".'}
${JSON.stringify(prShape, null, 2)}

Spec contradiction check (JSON), from the spec pass. ${specCheck ? "It is a verdict and not a finding: render it in its own section, as prose, and never as a bullet under a severity group. When `ran` is false, say the check did not run and why. When `contradictions` is empty, say which requirement ids were read, because a check that ran and a check that did not must not read the same." : 'The pass returned none, so write the section as "the spec check did not run".'}
${JSON.stringify(specCheck, null, 2)}

Human review decision (JSON), from the route pass. ${humanReview ? "It is a decision and not a finding: render it in its own section, as prose. Say whether a person must read the change, quote `summary`, and list each reason with its file, its rule and its level: `review` when a person must read it, `aware` when a team must only know about it. Never name a team: the step that posts the review names it from the map." : `The pass returned none (${routeFailure}), so write the section as "the human review check did not run".`}
${JSON.stringify(humanReview, null, 2)}

Things the passes called out as done right (JSON):
${JSON.stringify(
  ok.flatMap((r) => r.looksGood || []),
  null,
  2,
)}

Emit exactly this format, dropping any empty section:

# Maestro Review — <scope>

## Pull request shape

<the verdict — ship or split — then the headline and the reasoning, in two or three sentences of prose. On a split verdict, give the split.>

## Human review

<whether a person must read the change, the summary, and each reason with its file and rule.>

## Spec

<the requirement ids read, then any contradiction: what the requirement says, what the diff does instead, and the wording proposed. Say plainly that nothing edits the spec on its own.>

## Blocking (must fix)

- <finding> — [file:line] — <authority>

## Should fix

- ...

## Suggestions

- ...

## Looks good

- ...

Rules:
- **Keep the spec section out of the severity groups too.** A contradiction is a decision for the author, not a defect to rank, and the fix is an edit to the spec rather than to the code.
- **Keep the shape section first, and keep it out of the severity groups.** It answers a process question that the review answers once, and a reader decides on a split before reading a single finding. Drop the section only when the verdict is absent.
- Group comment findings into ONE entry per file, naming the lines to delete or the sentence worth keeping, so a reviewer can act in a single pass.
- Cite the authority on every line, so each reads as a rule of this team rather than a generic nitpick.
- End with a short "What ran" line naming every pass that ran, every pass that did not run and why, and the verified / unverified counts. A review is trusted in proportion to what it actually ran.
- Return the markdown only.`,
    {
      label: "synthesize:report",
      phase: "Synthesize",
      model: CHEAP_MODEL,
      effort: EFFORT.mechanical,
    },
  ),
);

if (!report) {
  throw new Error(
    `maestro-review: the passes ran but the synthesis agent returned nothing twice, so there is no report. ${reported.length} findings were collected — read them in the workflow journal, or launch a fresh review.`,
  );
}

return {
  report,
  prShape,
  specCheck,
  humanReview,
  blueprintMap: scope.blueprintMap || null,
  surfaces: surfaces.map((s) => s.id),
  findings: reported,
  confirmedCount: confirmedKept.length,
  droppedSuggestionCount,
  refutedCount: refuted.length,
  unverifiedCount: verificationFailures.length + beyondCap.length,
  passes: passes.map((p) => p.key),
  failedPasses,
};
