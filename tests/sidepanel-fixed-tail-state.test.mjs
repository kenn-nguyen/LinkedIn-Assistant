import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadFixedTailStateHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "sidepanel.js"), "utf8");
  const start = source.indexOf("function fixedTailFromRefreshResponse(response) {");
  const end = source.indexOf("\n\n  function buildJobDemoDraftHandoffText(job, person, draftContext) {", start);
  assert.ok(start >= 0 && end > start, "Expected fixed-tail state helpers in sidepanel.js");
  const helperSource = source.slice(start, end);
  const state = {
    fixedTail: "Draft in progress",
    savedFixedTail: "Persisted default",
    fixedTailDirty: true
  };
  const el = {
    fixedTailInput: {
      value: "Draft in progress"
    }
  };
  const documentMock = {
    activeElement: null
  };
  const context = vm.createContext({
    state,
    el,
    document: documentMock,
    FIXED_TAIL: "Persisted default"
  });
  const helpers = vm.runInContext(`(() => { ${helperSource}; return {
    fixedTailFromRefreshResponse,
    applyFixedTailRefreshResponse,
    syncFixedTailInputFromState
  }; })()`, context);
  return { ...helpers, state, el, documentMock };
}

test("applyFixedTailRefreshResponse keeps local edits when the settings field is dirty", () => {
  const { applyFixedTailRefreshResponse, state } = loadFixedTailStateHelpers();

  applyFixedTailRefreshResponse({ fixedTail: "Stored server value" });

  assert.equal(state.savedFixedTail, "Stored server value");
  assert.equal(state.fixedTail, "Draft in progress");
  assert.equal(state.fixedTailDirty, true);
});

test("applyFixedTailRefreshResponse updates the editor state when there are no local edits", () => {
  const { applyFixedTailRefreshResponse, state } = loadFixedTailStateHelpers();
  state.fixedTail = "Persisted default";
  state.savedFixedTail = "Persisted default";
  state.fixedTailDirty = false;

  applyFixedTailRefreshResponse({ fixedTail: "Stored server value" });

  assert.equal(state.savedFixedTail, "Stored server value");
  assert.equal(state.fixedTail, "Stored server value");
  assert.equal(state.fixedTailDirty, false);
});

test("syncFixedTailInputFromState preserves focused typing and repaints only when the field is not focused", () => {
  const { syncFixedTailInputFromState, state, el, documentMock } = loadFixedTailStateHelpers();

  documentMock.activeElement = el.fixedTailInput;
  el.fixedTailInput.value = "Typing now";
  syncFixedTailInputFromState();
  assert.equal(state.fixedTail, "Typing now");

  documentMock.activeElement = null;
  state.fixedTail = "Saved value";
  el.fixedTailInput.value = "Stale render";
  syncFixedTailInputFromState();
  assert.equal(el.fixedTailInput.value, "Saved value");
});
