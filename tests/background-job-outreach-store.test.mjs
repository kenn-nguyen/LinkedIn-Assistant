import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobOutreachStoreHelpers() {
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
    normalizeJobOutreachRunStatus,
    normalizeJobOutreachRun,
    normalizeJobOutreachStore,
    trimJobOutreachRuns
  }; })()`, context);
}

test("normalizeJobOutreachStore adds run registry fields while preserving legacy latestRun records", () => {
  const { normalizeJobOutreachStore } = loadJobOutreachStoreHelpers();

  const legacy = {
    jobsById: {
      "job:uber:senior-pm": {
        jobId: "job:uber:senior-pm",
        job: { title: "Senior Product Manager", company: "Uber" },
        latestRun: { runId: "legacy_run_1", status: "complete" },
        analytics: { totalSearchRuns: 1, lastSearchAt: "2026-05-09T18:00:00.000Z", searchTermHistory: [] }
      }
    }
  };

  const store = normalizeJobOutreachStore(legacy);

  assert.deepEqual(JSON.parse(JSON.stringify(store.queue)), []);
  assert.equal(store.activeRunId, "");
  assert.equal(store.runsById.legacy_run_1.status, "completed");
  assert.equal(store.jobsById["job:uber:senior-pm"].latestRun.runId, "legacy_run_1");
  assert.deepEqual(JSON.parse(JSON.stringify(store.runOrder)), ["legacy_run_1"]);
});

test("normalizeJobOutreachStore backfills legacy run job metadata from the parent job record", () => {
  const { normalizeJobOutreachStore } = loadJobOutreachStoreHelpers();

  const legacy = {
    jobsById: {
      "job:uber:senior-pm": {
        jobId: "job:uber:senior-pm",
        job: { title: "Senior Product Manager", company: "Uber" },
        latestRun: { runId: "legacy_run_1", status: "completed" },
        analytics: { totalSearchRuns: 1, lastSearchAt: "2026-05-09T18:00:00.000Z", searchTermHistory: [] }
      }
    },
    runsById: {
      legacy_run_1: {
        runId: "legacy_run_1",
        jobId: "job:uber:senior-pm",
        status: "completed"
      }
    },
    runOrder: ["legacy_run_1"]
  };

  const store = normalizeJobOutreachStore(legacy);

  assert.equal(store.runsById.legacy_run_1.job.title, "Senior Product Manager");
  assert.equal(store.runsById.legacy_run_1.job.company, "Uber");
});

test("trimJobOutreachRuns keeps active runs and trims old terminal runs", () => {
  const { trimJobOutreachRuns } = loadJobOutreachStoreHelpers();

  const runsById = {};
  const runOrder = [];
  for (let index = 0; index < 35; index += 1) {
    const runId = `done_${index}`;
    runOrder.push(runId);
    runsById[runId] = {
      runId,
      jobId: `job:${index}`,
      status: "completed",
      createdAt: `2026-05-10T12:${String(index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-05-10T12:${String(index).padStart(2, "0")}:30.000Z`
    };
  }
  runOrder.unshift("running_1");
  runsById.running_1 = {
    runId: "running_1",
    jobId: "job:running",
    status: "running",
    createdAt: "2026-05-10T11:00:00.000Z",
    updatedAt: "2026-05-10T11:05:00.000Z"
  };

  const trimmed = trimJobOutreachRuns({
    jobsById: {},
    filterCache: {},
    runsById,
    runOrder,
    queue: [],
    activeRunId: "running_1"
  });

  assert.equal(trimmed.runOrder[0], "running_1");
  assert.equal(trimmed.runsById.running_1.status, "running");
  assert.ok(trimmed.runOrder.length <= 26);
  assert.ok(!trimmed.runsById.done_34);
});

test("trimJobOutreachRuns aggressively drops old terminal runs under storage pressure", () => {
  const { trimJobOutreachRuns } = loadJobOutreachStoreHelpers();

  const runsById = {};
  const runOrder = [];
  for (let index = 0; index < 40; index += 1) {
    const runId = `done_${index}`;
    runOrder.push(runId);
    runsById[runId] = {
      runId,
      jobId: `job:${index}`,
      status: "completed",
      importedPeopleBySearch: { "1": new Array(20).fill({ name: "Person" }) },
      importedPeopleBySearchKey: { A: new Array(20).fill({ name: "Person" }) }
    };
  }

  const trimmed = trimJobOutreachRuns({
    jobsById: {},
    filterCache: {},
    runsById,
    runOrder,
    queue: [],
    activeRunId: ""
  }, { pressure: "high" });

  assert.ok(trimmed.runOrder.length <= 10);
});

test("trimJobOutreachRuns preserves active and current queue runs even under storage pressure", () => {
  const { trimJobOutreachRuns } = loadJobOutreachStoreHelpers();

  const trimmed = trimJobOutreachRuns({
    jobsById: {},
    filterCache: {},
    runsById: {
      active_1: { runId: "active_1", jobId: "job:active", status: "running" },
      queued_1: { runId: "queued_1", jobId: "job:queued", status: "queued" },
      done_1: { runId: "done_1", jobId: "job:done", status: "completed" }
    },
    runOrder: ["active_1", "queued_1", "done_1"],
    queue: ["queued_1"],
    activeRunId: "active_1"
  }, { pressure: "high" });

  assert.ok(trimmed.runsById.active_1);
  assert.ok(trimmed.runsById.queued_1);
});
