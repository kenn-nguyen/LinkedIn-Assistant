import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadBuildMissingMessageHistoryNextStep() {
  const source = fs.readFileSync(path.join(process.cwd(), "sidepanel.js"), "utf8");
  const start = source.indexOf("function buildMissingMessageHistoryNextStep(options) {");
  const end = source.indexOf("\n\n  function currentNextStepState()", start);
  assert.ok(start >= 0 && end > start, "Expected buildMissingMessageHistoryNextStep in sidepanel.js");
  const functionSource = source.slice(start, end);
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
  });
  return vm.runInContext(`(() => { ${functionSource}; return buildMissingMessageHistoryNextStep; })()`, context);
}

test("buildMissingMessageHistoryNextStep keeps drafting primary for connected profiles without saved thread history", () => {
  const buildMissingMessageHistoryNextStep = loadBuildMissingMessageHistoryNextStep();

  const result = buildMissingMessageHistoryNextStep({
    visibleThread: false,
    connectionStatus: "connected",
    helperProfileAction: { label: "Open profile", mode: "open_profile", disabled: false, targetUrl: "https://www.linkedin.com/in/test/" },
    helperThreadAction: null,
    draftAction: { label: "Draft first message", mode: "draft", disabled: false },
    onRecipientProfilePage: true,
    profileUrl: "https://www.linkedin.com/in/test/"
  });

  assert.equal(result.badgeLabel, "Ready to draft");
  assert.equal(result.primary.mode, "draft");
  assert.equal(result.primary.label, "Draft first message");
  assert.match(result.reason, /draft now/i);
});

test("buildMissingMessageHistoryNextStep still prefers importing or opening an actual thread when thread context exists", () => {
  const buildMissingMessageHistoryNextStep = loadBuildMissingMessageHistoryNextStep();

  const visibleThreadResult = buildMissingMessageHistoryNextStep({
    visibleThread: true,
    connectionStatus: "connected",
    helperProfileAction: { label: "Open profile", mode: "open_profile", disabled: false, targetUrl: "https://www.linkedin.com/in/test/" },
    helperThreadAction: { label: "Open thread", mode: "open_thread", disabled: false, targetUrl: "https://www.linkedin.com/messaging/thread/" },
    draftAction: { label: "Draft first message", mode: "draft", disabled: false },
    onRecipientProfilePage: false,
    profileUrl: "https://www.linkedin.com/in/test/"
  });

  assert.equal(visibleThreadResult.badgeLabel, "Thread needed");
  assert.equal(visibleThreadResult.primary.mode, "import_conversation");

  const threadOnlyResult = buildMissingMessageHistoryNextStep({
    visibleThread: false,
    connectionStatus: "connected",
    helperProfileAction: { label: "Open profile", mode: "open_profile", disabled: false, targetUrl: "https://www.linkedin.com/in/test/" },
    helperThreadAction: { label: "Open thread", mode: "open_thread", disabled: false, targetUrl: "https://www.linkedin.com/messaging/thread/" },
    draftAction: { label: "Draft first message", mode: "draft", disabled: false },
    onRecipientProfilePage: false,
    profileUrl: "https://www.linkedin.com/in/test/"
  });

  assert.equal(threadOnlyResult.badgeLabel, "Thread needed");
  assert.equal(threadOnlyResult.primary.mode, "open_thread");
});
