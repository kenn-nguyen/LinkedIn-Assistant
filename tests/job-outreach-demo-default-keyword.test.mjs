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

function buildDefaultKeywordContext(title) {
  return vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    stripKeywordChars(value) {
      return String(value || "").replace(/[^\p{L}\p{N}\s"]+/gu, " ");
    },
    sanitizeKeyword(value) {
      return String(value || "").replace(/[^\p{L}\p{N}\s"]+/gu, " ").replace(/\s+/g, " ").trim();
    },
    currentJob() {
      return { title };
    },
    senderProfileSlug() {
      return "kenn-nguyen";
    }
  });
}

test("defaultKeywordForCurrentJob keeps a quoted Vietnamese phrase for Kenn search A", () => {
  const functionSource = loadDefaultKeywordBuilder();
  const context = buildDefaultKeywordContext("Staff Product Manager");
  const defaultKeywordForCurrentJob = vm.runInContext(
    `(() => { ${functionSource}; return defaultKeywordForCurrentJob; })()`,
    context
  );

  // Quotes (exact-phrase operator) survive sanitization; other punctuation is stripped.
  assert.equal(defaultKeywordForCurrentJob(0), `"Vietnamese" Staff Product Manager`);
  assert.equal(defaultKeywordForCurrentJob(1), "Staff Product Manager");
});

test("defaultKeywordForCurrentJob strips punctuation but keeps quotes, Vietnamese letters and digits", () => {
  const functionSource = loadDefaultKeywordBuilder();
  const context = buildDefaultKeywordContext("Kỹ sư Backend (Java/Go) - Level 3!");
  const defaultKeywordForCurrentJob = vm.runInContext(
    `(() => { ${functionSource}; return defaultKeywordForCurrentJob; })()`,
    context
  );

  assert.equal(defaultKeywordForCurrentJob(0), `"Vietnamese" Kỹ sư Backend Java Go Level 3`);
});
