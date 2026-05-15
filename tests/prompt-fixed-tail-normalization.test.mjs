import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadPromptHelpers() {
  const source = fs.readFileSync(path.join(process.cwd(), "prompt.js"), "utf8");
  const start = source.indexOf("const LEGACY_FIXED_TAIL =");
  const end = source.indexOf("\n\n  function normalizeLlmProvider", start);
  assert.ok(start >= 0 && end > start, "Expected fixed-tail helpers in prompt.js");
  const helperSource = source.slice(start, end);
  const context = vm.createContext({
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
  });
  return vm.runInContext(`(() => { ${helperSource}; return { FIXED_TAIL, LEGACY_FIXED_TAIL, normalizeFixedTail }; })()`, context);
}

test("normalizeFixedTail preserves an intentional blank override", () => {
  const { normalizeFixedTail } = loadPromptHelpers();
  assert.equal(normalizeFixedTail(""), "");
  assert.equal(normalizeFixedTail("   "), "");
});

test("normalizeFixedTail still upgrades the legacy first-line default", () => {
  const { FIXED_TAIL, LEGACY_FIXED_TAIL, normalizeFixedTail } = loadPromptHelpers();
  assert.equal(normalizeFixedTail(LEGACY_FIXED_TAIL), FIXED_TAIL);
});

test("normalizeFixedTail still falls back to the shipped default only when the value is missing", () => {
  const { FIXED_TAIL, normalizeFixedTail } = loadPromptHelpers();
  assert.equal(normalizeFixedTail(undefined), FIXED_TAIL);
  assert.equal(normalizeFixedTail(null), FIXED_TAIL);
});
