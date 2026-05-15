import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadDefaultKeywordBuilder() {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  const match = source.match(/function defaultKeywordForCurrentJob\(searchIndex = 0\) \{[\s\S]*?\n  \}/);
  assert.ok(match, "Expected defaultKeywordForCurrentJob in job-outreach-demo.js");
  return match[0];
}

test("defaultKeywordForCurrentJob adds quoted Vietnamese phrase for Kenn search A", () => {
  const functionSource = loadDefaultKeywordBuilder();
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    currentJob() {
      return { title: "Staff Product Manager" };
    },
    senderProfileSlug() {
      return "kenn-nguyen";
    }
  });
  const defaultKeywordForCurrentJob = vm.runInContext(
    `(() => { ${functionSource}; return defaultKeywordForCurrentJob; })()`,
    context
  );

  assert.equal(defaultKeywordForCurrentJob(0), `"Vietnamese" Staff Product Manager`);
  assert.equal(defaultKeywordForCurrentJob(1), "Staff Product Manager");
});
