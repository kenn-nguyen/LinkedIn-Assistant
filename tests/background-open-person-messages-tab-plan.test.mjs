import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadBuildOpenPersonMessagesTabCreateProperties() {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const match = source.match(/function buildOpenPersonMessagesTabCreateProperties\(sourceTab, profileUrl\) \{[\s\S]*?\n\}/);
  assert.ok(match, "Expected buildOpenPersonMessagesTabCreateProperties in background.js");
  const context = vm.createContext({
    normalizeLinkedInProfileUrl(value) {
      return String(value || "").trim();
    },
    normalizeWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },
    Number
  });
  return vm.runInContext(`(() => { ${match[0]}; return buildOpenPersonMessagesTabCreateProperties; })()`, context);
}

test("buildOpenPersonMessagesTabCreateProperties opens a fresh adjacent active tab", () => {
  const buildOpenPersonMessagesTabCreateProperties = loadBuildOpenPersonMessagesTabCreateProperties();

  const result = buildOpenPersonMessagesTabCreateProperties(
    { id: 17, index: 4, windowId: 9 },
    "https://www.linkedin.com/in/test-user/"
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    url: "https://www.linkedin.com/in/test-user/",
    active: true,
    windowId: 9,
    index: 5,
    openerTabId: 17
  });
});
