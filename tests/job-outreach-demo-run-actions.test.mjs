import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadJobOutreachDemoRunActionHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  const start = source.indexOf("function normalizeJobOutreachRunStatus(status) {");
  const end = source.indexOf("\n\n  function renderManualFilterActions(filters) {", start);
  assert.ok(start >= 0 && end > start, "Expected Job Outreach run-registry helpers in job-outreach-demo.js");
  const helperSource = source.slice(start, end);
  const context = vm.createContext({
    state: {
      runsById: {},
      runOrder: [],
      pageRunIds: [],
      activeRunIds: [],
      activeRunId: ""
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
    jobOutreachRunActions,
    currentPageSearchActionLabel,
    isCurrentPageSearchBusy,
    shouldKeepSearchEditorOpenForCurrentPage,
    hasBlockingJobOutreachRun,
    __state: state
  }; })()`, context);
}

test("jobOutreachRunActions returns state-aware controls for queued, paused, and terminal runs", () => {
  const { jobOutreachRunActions } = loadJobOutreachDemoRunActionHelpers();

  assert.deepEqual(JSON.parse(JSON.stringify(jobOutreachRunActions({ status: "queued" }))), ["cancel", "select"]);
  assert.deepEqual(JSON.parse(JSON.stringify(jobOutreachRunActions({ status: "awaiting_user_action" }))), ["open-worker-tab", "resume", "cancel"]);
  assert.deepEqual(JSON.parse(JSON.stringify(jobOutreachRunActions({ status: "completed" }))), ["select", "dismiss"]);
});

test("current-page completed run uses rerun-first actions and does not expose dismiss in the primary card", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /"rerun-search": "Search again"/);
  assert.match(source, /"view-results": "View results"/);
  assert.doesNotMatch(source, /data-job-demo-current-page-action="dismiss"/);
});

test("current-page workspace does not render an empty-state run card copy when no saved run exists", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.doesNotMatch(source, /No saved run for this job yet/);
  assert.doesNotMatch(source, /Run search to build an outreach list for this role\./);
});

test("header search action label and busy state follow the current-page run status", () => {
  const { currentPageSearchActionLabel, isCurrentPageSearchBusy } = loadJobOutreachDemoRunActionHelpers();

  assert.equal(currentPageSearchActionLabel(null), "Search");
  assert.equal(currentPageSearchActionLabel({ status: "completed" }), "Search again");
  assert.equal(currentPageSearchActionLabel({ status: "running" }), "Search again");

  assert.equal(isCurrentPageSearchBusy(null), false);
  assert.equal(isCurrentPageSearchBusy({ status: "completed" }), false);
  assert.equal(isCurrentPageSearchBusy({ status: "ranking_complete" }), false);
  assert.equal(isCurrentPageSearchBusy({ status: "running" }), true);
  assert.equal(isCurrentPageSearchBusy({ status: "awaiting_user_action" }), true);
});

test("active current-page runs hide the header Search again action while work is in progress", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /nodes\.runSearch\.classList\.toggle\("hidden", !hasCurrentPageRun \|\| !collapsed \|\| isCurrentPageSearchBusy\(run\)\)/);
});

test("a JD with no saved run keeps the search editor open by default, while blocking active runs still disable search", () => {
  const { shouldKeepSearchEditorOpenForCurrentPage, hasBlockingJobOutreachRun, __state } = loadJobOutreachDemoRunActionHelpers();

  Object.assign(__state, {
    runsById: {},
    pageRunIds: [],
    activeRunIds: [],
    activeRunId: ""
  });
  assert.equal(shouldKeepSearchEditorOpenForCurrentPage(), true);
  assert.equal(hasBlockingJobOutreachRun(), false);

  Object.assign(__state, {
    activeRunIds: ["run_other"]
  });
  assert.equal(hasBlockingJobOutreachRun(), true);

  Object.assign(__state, {
    runsById: {
      run_page: { runId: "run_page", status: "completed" }
    },
    pageRunIds: ["run_page"],
    activeRunIds: [],
    activeRunId: ""
  });
  assert.equal(shouldKeepSearchEditorOpenForCurrentPage(), false);

  Object.assign(__state, {
    runsById: {
      run_page_active: { runId: "run_page_active", status: "running" },
      run_page_previous: { runId: "run_page_previous", status: "completed" }
    },
    pageRunIds: ["run_page_active", "run_page_previous"],
    activeRunIds: ["run_page_active"],
    activeRunId: "run_page_active"
  });
  assert.equal(shouldKeepSearchEditorOpenForCurrentPage(), true);
});

test("a JD with no saved run does not expose the cancel affordance in the forced-open editor", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /nodes\.cancelSearchEdit\?\.classList\.toggle\("hidden", !hasCurrentPageRun \|\| collapsed\)/);
});

test("job workspace removes the Current page card label and does not keep a saved-search summary block inside the search card", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  assert.doesNotMatch(html, />Current page</);
  assert.doesNotMatch(html, /id="job-demo-search-summary-list"/);
});

test("job workspace labels the search card as referral search instead of generic people finding", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  assert.match(html, />Search for referrals</);
  assert.doesNotMatch(html, />Find people</);
});

test("saved-run status copy is driven by workflow progress text instead of repeating the job title", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.doesNotMatch(source, /nodes\.runSummary\.textContent = displayJob\.title \|\| selectedRunTitle\(run\);/);
});

test("job workspace replaces the chevron header control with a search action and bottom editor actions", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  assert.doesNotMatch(html, /Collapse people search/);
  assert.match(html, /id="job-demo-run-search"/);
  assert.match(html, /id="job-demo-submit-search"/);
  assert.match(html, /id="job-demo-cancel-search-edit"/);
});

test("current-page saved runs do not overwrite the editor entries on refresh", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.doesNotMatch(source, /state\.entries = pageEntries;/);
});

test("job workspace separates search controls, progress, and ranked results into distinct surfaces", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  assert.match(
    html,
    /<section id="job-demo-search-panel"[\s\S]*?<\/section>\s*<div id="job-demo-run-panel"[\s\S]*?<\/div>\s*<div id="job-demo-activity-banner"[\s\S]*?<\/div>\s*<section id="job-demo-rank-panel"[\s\S]*?<div id="job-demo-rank-tabs"[\s\S]*?<div id="job-demo-results-search-links"/
  );
});

test("search card does not render saved-search summary rows", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.doesNotMatch(source, /renderSearchSummaryList/);
  assert.doesNotMatch(source, /job-demo-search-summary-row/);
});

test("saved search URLs render as one clickable Search A URL link under the result tabs", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(html, /id="job-demo-results-search-links"/);
  assert.match(source, /resultsSearchLinks: getNode\("job-demo-results-search-links"\)/);
  assert.match(source, /class="job-demo-results-search-link" href="\$\{escapeHtml\(url\)\}" target="_blank" rel="noreferrer">\$\{escapeHtml\(`\$\{label\} URL`\)\}<\/a>/);
});

test("results search links are indented to align with the recommendation copy inside person cards", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.match(css, /\.job-demo-results-search-links \{[\s\S]*padding-left: 20px;/);
});

test("results search links stay inline on one row instead of stacking vertically", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.match(css, /\.job-demo-results-search-links \{[\s\S]*display: flex;/);
  assert.match(css, /\.job-demo-results-search-links \{[\s\S]*flex-wrap: wrap;/);
  assert.match(css, /\.job-demo-results-search-link \{[\s\S]*white-space: nowrap;/);
});

test("search card header vertically aligns the title and action button", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.match(css, /\.job-demo-section-heading \{[\s\S]*align-items: center;/);
});

test("collapsed search card trims the bottom gap when only the header row is visible", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.match(css, /\.job-demo-search-panel\.is-collapsed \{[\s\S]*padding-bottom: 10px;/);
  assert.match(css, /\.job-demo-search-panel\.is-collapsed \.job-demo-section-heading \{[\s\S]*margin-bottom: 0;/);
});

test("search status keeps relevant spacing from the search card and results card", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.match(css, /\.job-demo-run-status \{[\s\S]*margin: 16px 0 14px;/);
});

test("result cards rely on the native dark tooltip only and do not render the pink keyword overlay", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.doesNotMatch(source, /renderCardKeywordTooltip\(keywordTooltip\)/);
  assert.doesNotMatch(source, /job-demo-card-keywords/);
  assert.doesNotMatch(css, /\.job-demo-card-keywords/);
});

test("profile navigation is owned by the person name link instead of a separate Profile button", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.match(source, /<a class="job-demo-person-name" href="\$\{escapeHtml\(person\.profileUrl\)\}"/);
  assert.doesNotMatch(source, /job-demo-profile-button/);
  assert.doesNotMatch(source, /displayPersonAction\(person\)/);
  assert.doesNotMatch(css, /\.job-demo-profile-button/);
});

test("result cards show best use, outreach approach, and reason while preserving avatar images", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /bestUse: strategy\.bestUse/);
  assert.match(source, /job-demo-result-best-use/);
  assert.match(source, /Best use:/);
  assert.match(source, /job-demo-result-approach/);
  assert.match(source, /Best ask:/);
  assert.match(source, /job-demo-reason/);
  assert.match(source, /<img src="\$\{escapeHtml\(person\.avatarUrl\)\}" alt="\$\{escapeHtml\(person\.name\)\}">/);
});

test("result cards compress search source into the header line and place headline before the strategy blocks", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "sidepanel.css"), "utf8");
  assert.doesNotMatch(source, /From \$\{escapeHtml\(person\.source\)\}/);
  assert.doesNotMatch(source, /job-demo-connection-degree/);
  assert.doesNotMatch(source, /job-demo-result-source-badge/);
  assert.match(source, /const supportingMeta = \[\s*normalizeWhitespace\(person\.connectionDegree\) \? escapeHtml\(normalizeWhitespace\(person\.connectionDegree\)\) : "",\s*sourceBadge \? escapeHtml\(sourceBadge\) : "",\s*renderResultMeta\(person\)\s*\]\.filter\(Boolean\)\.join\(" - "\);/);
  assert.match(source, /<p class="job-demo-result-identity-line">\s*<a class="job-demo-person-name"/);
  assert.match(source, /\$\{supportingMeta \? `<span class="job-demo-result-supporting-meta"> - \$\{supportingMeta\}<\/span>` : ""\}/);
  assert.match(source, /<p class="job-demo-result-best-use"><strong>Best use:<\/strong> \$\{escapeHtml\(bestUseLabel\)\}<\/p>/);
  assert.match(source, /<\/div>\s*<\/div>\s*\$\{person\.approachStrategy \? `<p class="job-demo-result-approach"><strong>Best ask:<\/strong> \$\{escapeHtml\(person\.approachStrategy\)\}<\/p>` : ""\}/);
  assert.match(source, /<p class="job-demo-reason"><strong>Why this person:<\/strong> \$\{escapeHtml\(person\.reason\)\}<\/p>/);
  assert.match(css, /\.job-demo-result-avatar \{[\s\S]*float: left;/);
  assert.match(css, /\.job-demo-person-actions \{[\s\S]*float: right;/);
  assert.match(css, /\.job-demo-result-identity-line \{/);
  assert.match(css, /\.job-demo-result-supporting-meta \{[\s\S]*font-size: 11px;/);
  assert.match(css, /\.job-demo-result-approach,\s*\.job-demo-reason \{[\s\S]*margin-left: 0;/);
});

test("expanded search editor exposes bottom Search and Cancel actions while the header button remains separate", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(html, /id="job-demo-submit-search"/);
  assert.match(html, /id="job-demo-cancel-search-edit"/);
  assert.match(source, /nodes\.runSearch\.classList\.toggle\("hidden", !hasCurrentPageRun \|\| !collapsed \|\| isCurrentPageSearchBusy\(run\)\)/);
});

test("current-page completion copy no longer uses the completed pill, ranked-people-ready copy, or timestamp metadata", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.doesNotMatch(source, /Ranked people ready/);
  assert.doesNotMatch(source, /selectedRunSubtitle\(/);
});

test("completed off-page status does not keep the progress bar visible", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /nodes\.progressFill\.parentElement\?\.classList\.toggle\("hidden", progressPercent <= 0 \|\| status === "completed"\)/);
});

test("results stay hidden until the current-page run is completed", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /const resultsRun = activeResultsRun\(\);/);
  assert.match(source, /const canShowResults = normalizeJobOutreachRunStatus\(resultsRun\?\.status\) === "completed" && hasAnyRankingPeople\(state\.rankings\);/);
  assert.match(source, /if \(canShowResults\) \{/);
  assert.match(source, /nodes\.rankPanel\?\.classList\.add\("hidden"\);/);
});

test("search card cancel button cancels an active run instead of only collapsing the editor", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /async function cancelSearchEditor\(\)/);
  assert.match(source, /if \(run && isCurrentPageSearchBusy\(run\)\) \{/);
  assert.match(source, /await cancelBackgroundJobOutreach\(run\.runId\)/);
});

test("same-page completed state does not keep a standalone completion strip above results", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "job-outreach-demo.js"), "utf8");
  assert.match(source, /function isSamePageCompletedRun\(run, currentPageRun\)/);
  assert.match(source, /if \(isSamePageCompletedRun\(run, currentPageRun\)\) \{/);
});

test("background activity has its own banner container and link", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "sidepanel.html"), "utf8");
  assert.match(html, /id="job-demo-activity-banner"/);
  assert.match(html, /id="job-demo-activity-link"/);
});
