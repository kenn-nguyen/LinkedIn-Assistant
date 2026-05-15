import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function loadIsMissingReceiverError() {
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  const match = source.match(/function isMissingReceiverError\(error\) \{[\s\S]*?\n\}/);
  assert.ok(match, "Expected isMissingReceiverError helper in background.js");
  const context = vm.createContext({});
  return vm.runInContext(`(() => { ${match[0]}; return isMissingReceiverError; })()`, context);
}

test("isMissingReceiverError treats channel-closed navigation errors as retryable", () => {
  const isMissingReceiverError = loadIsMissingReceiverError();

  assert.equal(
    isMissingReceiverError(new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received")),
    true
  );
  assert.equal(
    isMissingReceiverError(new Error("Could not establish connection. Receiving end does not exist.")),
    true
  );
});
