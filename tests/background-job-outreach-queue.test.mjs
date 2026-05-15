import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobOutreachQueueHelpers() {
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
    promoteNextQueuedJobOutreachRun
  }; })()`, context);
}

test("promoteNextQueuedJobOutreachRun keeps one active execution and promotes the next queued run", () => {
  const { promoteNextQueuedJobOutreachRun } = loadJobOutreachQueueHelpers();

  const promoted = promoteNextQueuedJobOutreachRun({
    jobsById: {},
    filterCache: {},
    runsById: {
      run_a: { runId: "run_a", jobId: "job:a", status: "completed" },
      run_b: { runId: "run_b", jobId: "job:b", status: "queued" }
    },
    runOrder: ["run_a", "run_b"],
    queue: ["run_b"],
    activeRunId: ""
  });

  assert.equal(promoted.store.activeRunId, "run_b");
  assert.equal(promoted.store.runsById.run_b.status, "running");
  assert.deepEqual(JSON.parse(JSON.stringify(promoted.store.queue)), []);
  assert.equal(promoted.nextRun.runId, "run_b");
});
