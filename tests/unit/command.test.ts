import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../../backend/src/utils/command.js";

test("parseCommand splits command and args", () => {
  const parsed = parseCommand('python -m http.server 8000');
  assert.equal(parsed.file, "python");
  assert.deepEqual(parsed.args, ["-m", "http.server", "8000"]);
});

test("parseCommand handles quoted arguments", () => {
  const parsed = parseCommand('echo "hello world"');
  assert.equal(parsed.file, "echo");
  assert.deepEqual(parsed.args, ["hello world"]);
});
