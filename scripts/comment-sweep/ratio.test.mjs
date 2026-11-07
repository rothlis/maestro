import test from "node:test"
import assert from "node:assert/strict"

import { countDiff, isCounted, report } from "./ratio.mjs"

test("a new file with more comment lines than code lines is reported", () => {
  const diff = `diff --git a/a.ts b/a.ts
new file mode 100644
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,7 @@
+/**
+ * Says what the next line says.
+ */
+// and again
+
+export const a = 1
`
  const result = report(countDiff(diff))
  assert.deepEqual(result.newFilesWithMoreCommentThanCode, ["a.ts"])
  assert.equal(result.comment, 4)
  assert.equal(result.code, 1)
  assert.equal(result.ratio, 0.8)
})

test("only added lines count, and a block opened on a context line still counts", () => {
  const diff = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,4 +1,5 @@
 /*
+ * an added line inside an old block
  */
-const removed = 1
+const added = 1
 const kept = 2
`
  assert.deepEqual(countDiff(diff), [
    { file: "b.ts", comment: 1, code: 1, isNew: false },
  ])
})

test("a block that opens at the end of one hunk does not swallow the next hunk", () => {
  const diff = `diff --git a/d.ts b/d.ts
--- a/d.ts
+++ b/d.ts
@@ -1,2 +1,3 @@
 const before = 1
+const added = 1
 /**
@@ -40,2 +41,3 @@
 const later = 2
+const alsoAdded = 2
`
  assert.deepEqual(countDiff(diff), [
    { file: "d.ts", comment: 0, code: 2, isNew: false },
  ])
})

test("a JSDoc line added inside a block that opened before the hunk is a comment", () => {
  const diff = `diff --git a/e.ts b/e.ts
--- a/e.ts
+++ b/e.ts
@@ -10,3 +10,4 @@
  * an old line of a long JSDoc
+ * an added line of the same JSDoc
  */
 export const e = 1
`
  assert.deepEqual(countDiff(diff), [
    { file: "e.ts", comment: 1, code: 0, isNew: false },
  ])
})

test("bold prose in a template literal and a generator method are code", () => {
  const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,1 +1,4 @@
 const prompt = \`
+**Read the file first.**
+\`
+  *items() {}
`
  assert.deepEqual(countDiff(diff), [
    { file: "f.ts", comment: 0, code: 3, isNew: false },
  ])
})

test("a one-line block comment does not swallow the code after it", () => {
  const diff = `diff --git a/c.ts b/c.ts
--- a/c.ts
+++ b/c.ts
@@ -0,0 +1,2 @@
+/* one line */
+const c = 1
`
  assert.deepEqual(countDiff(diff), [
    { file: "c.ts", comment: 1, code: 1, isNew: false },
  ])
})

test("tests, stories and non-source files stay out of the count", () => {
  assert.equal(isCounted("a.test.ts"), false)
  assert.equal(isCounted("a.stories.tsx"), false)
  assert.equal(isCounted("src/__tests__/a.ts"), false)
  assert.equal(isCounted("README.md"), false)
  assert.equal(isCounted("a.mjs"), true)
})
