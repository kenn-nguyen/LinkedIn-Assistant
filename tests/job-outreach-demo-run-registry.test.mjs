import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobOutreachDemoRunRegistryHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  const start = source.indexOf("function normalizeJobOutreachRunStatus(status) {");
  const end = source.indexOf("\n\n  function renderManualFilterActions(filters) {", start);
  assert.ok(start >= 0 && end > start, "Expected Job Outreach run-registry helpers in job-outreach-demo.js");
  const helperSource = source.slice(start, end);
  const context = vm.createContext({
    state: {
      pageRunIds: [],
      runtimeJob: null
    },
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    JSON,
    Object,
    Array,
    Number,
    Math,
    Set
  });
  return vm.runInContext(`(() => { ${helperSource}; return {
    normalizeJobOutreachRunSnapshot,
    mergeJobOutreachRunsState,
    mergeJobOutreachProgressIntoState,
    selectedRunTitle,
    currentPageRunId,
    currentPageJobOutreachRun,
    activeResultsRun,
    visibleStatusRun,
    searchHistoryRuns,
    __state: state
  }; })()`, context);
}

test("mergeJobOutreachRunsState keeps prior run progress visible after runtime job changes to another page", () => {
  const { mergeJobOutreachRunsState } = loadJobOutreachDemoRunRegistryHelpers();

  const initialState = {
    runsById: {},
    runOrder: [],
    pageRunIds: [],
    activeRunIds: [],
    selectedRunId: "",
    selectedRunSource: ""
  };

  const afterUber = mergeJobOutreachRunsState(initialState, {
    runsById: {
      run_1: {
        runId: "run_1",
        jobId: "job:123",
        status: "running",
        progressText: "Importing people..."
      }
    },
    runOrder: ["run_1"],
    pageRunIds: ["run_1"],
    activeRunIds: ["run_1"],
    selectedRunId: "run_1"
  });

  const afterStripe = mergeJobOutreachRunsState(afterUber, {
    runsById: afterUber.runsById,
    runOrder: ["run_1"],
    pageRunIds: [],
    activeRunIds: ["run_1"],
    selectedRunId: ""
  });

  assert.equal(afterStripe.runsById.run_1.progressText, "Importing people...");
  assert.equal(afterStripe.selectedRunId, "");
  assert.deepEqual(JSON.parse(JSON.stringify(afterStripe.activeRunIds)), ["run_1"]);
});

test("mergeJobOutreachProgressIntoState merges progress by request id instead of dropping non-selected runs", () => {
  const { mergeJobOutreachProgressIntoState } = loadJobOutreachDemoRunRegistryHelpers();

  const nextState = mergeJobOutreachProgressIntoState({
    runsById: {
      run_1: { runId: "run_1", status: "queued", progressText: "Queued..." }
    },
    runOrder: ["run_1"],
    selectedRunId: "",
    selectedRunSource: "",
    activeRunIds: [],
    pageRunIds: []
  }, {
    requestId: "run_2",
    text: "Reading Search A.",
    detail: "Waiting for LinkedIn search page to load.",
    progressPercent: 38,
    status: "loading_search",
    sourceTabId: 22,
    workerTabId: 31
  });

  assert.equal(nextState.runsById.run_2.progressText, "Reading Search A.");
  assert.equal(nextState.runsById.run_2.workerTabId, 31);
  assert.deepEqual(JSON.parse(JSON.stringify(nextState.runOrder)), ["run_2", "run_1"]);
});

test("selectedRunTitle prefers job metadata and never falls back to the raw run id", () => {
  const { selectedRunTitle } = loadJobOutreachDemoRunRegistryHelpers();

  assert.equal(selectedRunTitle({
    runId: "job_outreach_1778360269526_rrfbsm",
    job: { company: "Uber", title: "Senior Product Manager" }
  }), "Uber - Senior Product Manager");

  assert.equal(selectedRunTitle({
    runId: "job_outreach_1778360269526_rrfbsm",
    job: {}
  }), "Saved Job Outreach run");
});

test("currentPageJobOutreachRun stays anchored to the visible page even when another run is selected", () => {
  const helpers = loadJobOutreachDemoRunRegistryHelpers();
  const { currentPageRunId, currentPageJobOutreachRun, activeResultsRun } = helpers;

  Object.assign(helpers.__state, {
    runsById: {
      run_page: { runId: "run_page", job: { company: "Datadog", title: "Senior Product Manager" }, status: "completed" },
      run_history: { runId: "run_history", job: { company: "Uber", title: "Senior Product Manager" }, status: "completed" }
    },
    runOrder: ["run_page", "run_history"],
    pageRunIds: ["run_page"],
    activeRunIds: [],
    selectedRunId: "run_history",
    selectedRunSource: "user"
  });

  assert.equal(currentPageRunId(), "run_page");
  assert.equal(currentPageJobOutreachRun()?.runId, "run_page");
  assert.equal(activeResultsRun()?.runId, "run_page");
});

test("activeResultsRun falls back to the current page run when no history run is selected", () => {
  const helpers = loadJobOutreachDemoRunRegistryHelpers();
  const { currentPageJobOutreachRun, activeResultsRun } = helpers;

  Object.assign(helpers.__state, {
    runsById: {
      run_page: { runId: "run_page", job: { company: "Datadog", title: "Senior Product Manager" }, status: "completed" }
    },
    runOrder: ["run_page"],
    pageRunIds: ["run_page"],
    activeRunIds: [],
    selectedRunId: "",
    selectedRunSource: ""
  });

  assert.equal(currentPageJobOutreachRun()?.runId, "run_page");
  assert.equal(activeResultsRun()?.runId, "run_page");
});

test("searchHistoryRuns returns no cross-job history for the current-page-only workspace", () => {
  const helpers = loadJobOutreachDemoRunRegistryHelpers();
  const { searchHistoryRuns } = helpers;

  Object.assign(helpers.__state, {
    runsById: {
      run_page: { runId: "run_page", job: { company: "Datadog", title: "Senior Product Manager" }, status: "completed" },
      run_history: { runId: "run_history", job: { company: "Uber", title: "Senior Product Manager" }, status: "completed" },
      run_other: { runId: "run_other", job: { company: "Checkr", title: "Senior Staff Product Manager" }, status: "completed" }
    },
    runOrder: ["run_page", "run_history", "run_other"],
    pageRunIds: ["run_page"],
    activeRunIds: [],
    selectedRunId: "run_history",
    selectedRunSource: "user"
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(searchHistoryRuns())),
    []
  );
});

test("activeResultsRun is empty when the current page has no saved run and no explicit history review is active", () => {
  const helpers = loadJobOutreachDemoRunRegistryHelpers();
  const { activeResultsRun } = helpers;

  Object.assign(helpers.__state, {
    runsById: {
      run_other: { runId: "run_other", job: { company: "Uber", title: "Senior Product Manager" }, status: "completed" }
    },
    runOrder: ["run_other"],
    pageRunIds: [],
    activeRunIds: [],
    selectedRunId: "",
    selectedRunSource: ""
  });

  assert.equal(activeResultsRun(), null);
});

test("visibleStatusRun carries active or latest completed off-page progress across screens", () => {
  const helpers = loadJobOutreachDemoRunRegistryHelpers();
  const { visibleStatusRun } = helpers;

  Object.assign(helpers.__state, {
    runsById: {
      run_other: {
        runId: "run_other",
        status: "running",
        progressText: "Reading visible results",
        job: { company: "Uber", title: "Senior Product Manager", sourceUrl: "https://linkedin.com/jobs/view/1" }
      }
    },
    runOrder: ["run_other"],
    pageRunIds: [],
    activeRunIds: ["run_other"],
    selectedRunId: "",
    selectedRunSource: ""
  });
  assert.equal(visibleStatusRun()?.runId, "run_other");

  Object.assign(helpers.__state, {
    runsById: {
      run_other: {
        runId: "run_other",
        status: "completed",
        progressText: "Search completed.",
        job: { company: "Uber", title: "Senior Product Manager", sourceUrl: "https://linkedin.com/jobs/view/1" }
      }
    },
    runOrder: ["run_other"],
    pageRunIds: [],
    activeRunIds: [],
    selectedRunId: "",
    selectedRunSource: ""
  });
  assert.equal(visibleStatusRun()?.runId, "run_other");
});

test("current-page-only workspace does not expose cross-job history rows", () => {
  const helpers = loadJobOutreachDemoRunRegistryHelpers();
  const { searchHistoryRuns } = helpers;

  Object.assign(helpers.__state, {
    runsById: {
      run_page: { runId: "run_page", job: { company: "Datadog", title: "Senior Product Manager" }, status: "completed" },
      run_other: { runId: "run_other", job: { company: "Uber", title: "Senior Product Manager" }, status: "completed" }
    },
    runOrder: ["run_page", "run_other"],
    pageRunIds: ["run_page"],
    activeRunIds: [],
    selectedRunId: "",
    selectedRunSource: ""
  });

  assert.deepEqual(JSON.parse(JSON.stringify(searchHistoryRuns())), []);
});
