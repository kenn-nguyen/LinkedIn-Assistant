import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobOutreachCancelHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const start = source.indexOf("function normalizeJobOutreachRunStatus(status) {");
  const end = source.indexOf("\n\nconst JOB_OUTREACH_FILTER_PARAMS = {", start);
  assert.ok(start >= 0 && end > start, "Expected Job Outreach store helpers in background.js");
  const helperSource = source.slice(start, end);
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    normalizeJobOutreachJob(job) {
      const source = job || {};
      return {
        title: String(source.title || "").trim(),
        company: String(source.company || "").trim(),
        location: String(source.location || "").trim(),
        datePosted: String(source.datePosted || "").trim(),
        sourceUrl: String(source.sourceUrl || source.jobUrl || source.pageUrl || "").trim(),
        description: String(source.description || "").trim(),
        jobId: String(source.jobId || "").trim()
      };
    },
    normalizeJobOutreachFilterCache(cache) {
      return cache && typeof cache === "object" ? cache : {};
    },
    uniqueStrings(values) {
      const seen = new Set();
      return (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .filter((value) => {
          const key = value.toLowerCase();
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
    },
    toIsoNow() {
      return "2026-05-10T12:00:00.000Z";
    },
    Math,
    Number,
    Object,
    Array,
    JSON
  });
  return vm.runInContext(`(() => { ${helperSource}; return {
    cancelJobOutreachRunInStore
  }; })()`, context);
}

test("cancelJobOutreachRunInStore marks queued runs cancelled immediately and requests cooperative cancel for running runs", () => {
  const { cancelJobOutreachRunInStore } = loadJobOutreachCancelHelpers();

  const store = {
    jobsById: {},
    filterCache: {},
    runsById: {
      queued_1: { runId: "queued_1", jobId: "job:1", status: "queued", cancelRequested: false },
      running_1: { runId: "running_1", jobId: "job:2", status: "running", cancelRequested: false }
    },
    runOrder: ["running_1", "queued_1"],
    queue: ["queued_1"],
    activeRunId: "running_1"
  };

  const queuedResult = cancelJobOutreachRunInStore(store, "queued_1");
  const runningResult = cancelJobOutreachRunInStore(queuedResult, "running_1");

  assert.equal(queuedResult.runsById.queued_1.status, "cancelled");
  assert.equal(queuedResult.queue.length, 0);
  assert.equal(runningResult.runsById.running_1.cancelRequested, true);
  assert.equal(runningResult.runsById.running_1.status, "running");
});
