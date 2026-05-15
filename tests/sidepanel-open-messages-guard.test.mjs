import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadOpenMessagesGuardHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "sidepanel.js"), "utf8");
  const start = source.indexOf("function normalizeOpenCurrentLinkedInMessagesOptions(profileUrlOverride) {");
  const end = source.indexOf("\n\n  async function openCurrentLinkedInMessages(profileUrlOverride) {", start);
  assert.ok(start >= 0 && end > start, "Expected open-messages option helpers in sidepanel.js");
  const helperSource = source.slice(start, end);
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
  });
  return vm.runInContext(`(() => { ${helperSource}; return {
    normalizeOpenCurrentLinkedInMessagesOptions,
    isAutomatedMessageOpenAllowed
  }; })()`, context);
}

test("generic open-current-linkedin-messages calls default to the non-automated next-step source", () => {
  const { normalizeOpenCurrentLinkedInMessagesOptions, isAutomatedMessageOpenAllowed } = loadOpenMessagesGuardHelpers();

  const options = normalizeOpenCurrentLinkedInMessagesOptions(" https://www.linkedin.com/in/test/ ");

  assert.equal(options.profileUrl, "https://www.linkedin.com/in/test/");
  assert.equal(options.source, "next_step");
  assert.equal(isAutomatedMessageOpenAllowed(options), false);
});

test("job-demo open-current-linkedin-messages calls stay explicitly allowed", () => {
  const { normalizeOpenCurrentLinkedInMessagesOptions, isAutomatedMessageOpenAllowed } = loadOpenMessagesGuardHelpers();

  const options = normalizeOpenCurrentLinkedInMessagesOptions({
    profileUrl: "https://www.linkedin.com/in/test/",
    source: "job_demo",
    progressStatusText: "Opening LinkedIn messaging in a new tab for tailoring.",
    openedStatusText: "Opened LinkedIn messaging in a new tab for tailoring.",
    suppressImportStatus: true
  });

  assert.equal(options.source, "job_demo");
  assert.equal(isAutomatedMessageOpenAllowed(options), true);
  assert.equal(options.suppressImportStatus, true);
});
