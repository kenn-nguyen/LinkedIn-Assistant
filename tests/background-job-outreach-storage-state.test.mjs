import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobOutreachStorageStateHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const storeStart = source.indexOf("function normalizeJobOutreachRunStatus(status) {");
  const storeEnd = source.indexOf("\n\nconst JOB_OUTREACH_FILTER_PARAMS = {", storeStart);
  const selectorStart = source.indexOf("function jobOutreachRunsForPage(pageContext, stored) {");
  const selectorEnd = source.indexOf("\n\nfunction compactJobOutreachHistoryEntry(", selectorStart);
  assert.ok(storeStart >= 0 && storeEnd > storeStart, "Expected Job Outreach store helpers in background.js");
  assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, "Expected jobOutreachRunsForPage in background.js");
  const helperSource = `${source.slice(storeStart, storeEnd)}\n${source.slice(selectorStart, selectorEnd)}`;
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
    jobIdFromJob(job) {
      const source = job || {};
      if (source.jobId) {
        return `li_job_${String(source.jobId).trim()}`;
      }
      const url = String(source.sourceUrl || source.jobUrl || source.pageUrl || source.jobPostingUrl || "").trim();
      const match = url.match(/(?:currentJobId=|\/jobs\/view\/)(\d+)/i);
      return match ? `li_job_${match[1]}` : "";
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
    normalizeJobOutreachStore,
    jobOutreachRunsForPage
  }; })()`, context);
}

test("jobOutreachRunsForPage returns current-page runs plus active runs from other jobs", () => {
  const { jobOutreachRunsForPage } = loadJobOutreachStorageStateHelpers();

  const pageContext = {
    job: {
      jobPostingUrl: "https://www.linkedin.com/jobs/view/123/",
      sourceUrl: "https://www.linkedin.com/jobs/view/123/",
      title: "Senior Product Manager",
      company: "Uber"
    }
  };
  const stored = {
    jobOutreach: {
      jobsById: {},
      filterCache: {},
      runsById: {
        run_page_1: { runId: "run_page_1", jobId: "li_job_123", status: "running" },
        run_other_1: { runId: "run_other_1", jobId: "li_job_456", status: "queued" },
        run_done: { runId: "run_done", jobId: "li_job_123", status: "completed" }
      },
      runOrder: ["run_page_1", "run_other_1", "run_done"],
      queue: ["run_other_1"],
      activeRunId: "run_page_1"
    }
  };

  const response = jobOutreachRunsForPage(pageContext, stored);

  assert.deepEqual(JSON.parse(JSON.stringify(response.pageRunIds)), ["run_page_1", "run_done"]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.activeRunIds)), ["run_page_1", "run_other_1"]);
  assert.equal(response.selectedRunId, "run_page_1");
});

test("jobOutreachRunsForPage does not auto-select a run when the current page has no saved runs", () => {
  const { jobOutreachRunsForPage } = loadJobOutreachStorageStateHelpers();

  const pageContext = {
    job: {
      jobPostingUrl: "https://www.linkedin.com/jobs/view/999/",
      sourceUrl: "https://www.linkedin.com/jobs/view/999/",
      title: "Lead Product Manager",
      company: "Bill"
    }
  };
  const stored = {
    jobOutreach: {
      jobsById: {},
      filterCache: {},
      runsById: {
        run_other_1: { runId: "run_other_1", jobId: "li_job_456", status: "queued" },
        run_other_2: { runId: "run_other_2", jobId: "li_job_123", status: "completed" }
      },
      runOrder: ["run_other_1", "run_other_2"],
      queue: ["run_other_1"],
      activeRunId: ""
    }
  };

  const response = jobOutreachRunsForPage(pageContext, stored);

  assert.deepEqual(JSON.parse(JSON.stringify(response.pageRunIds)), []);
  assert.equal(response.selectedRunId, "");
});

test("jobOutreachRunsForPage returns only current-page runs and current-page selection metadata", () => {
  const { jobOutreachRunsForPage } = loadJobOutreachStorageStateHelpers();

  const pageContext = {
    job: {
      jobPostingUrl: "https://www.linkedin.com/jobs/view/999/",
      sourceUrl: "https://www.linkedin.com/jobs/view/999/",
      title: "Senior Product Manager - Integrations & Ecosystem",
      company: "Datadog"
    }
  };
  const stored = {
    jobOutreach: {
      jobsById: {},
      filterCache: {},
      runsById: {
        run_page_1: { runId: "run_page_1", jobId: "li_job_999", status: "completed" },
        run_other_1: { runId: "run_other_1", jobId: "li_job_123", status: "completed" }
      },
      runOrder: ["run_page_1", "run_other_1"],
      queue: [],
      activeRunId: ""
    }
  };

  const response = jobOutreachRunsForPage(pageContext, stored);

  assert.deepEqual(JSON.parse(JSON.stringify(response.pageRunIds)), ["run_page_1"]);
  assert.equal(response.selectedRunId, "run_page_1");
  assert.ok(!("historyRunIds" in response));
});
