import test from "node:test";
import assert from "node:assert/strict";
import { HistoryRing } from "../../backend/src/term/history-ring.js";

test("HistoryRing keeps only latest N lines", () => {
  const ring = new HistoryRing(3);

  ring.push([["line1", 0]]);
  ring.push([["line2", 0]]);
  ring.push([["line3", 0]]);
  ring.push([["line4", 0]]);

  const newest = ring.newestCursor();
  const fetched = ring.fetch(newest, 10);

  assert.equal(ring.size(), 3);
  assert.equal(fetched.lines.length, 3);
  assert.equal(fetched.lines[0].segs[0][0], "line2");
  assert.equal(fetched.lines[2].segs[0][0], "line4");
});

test("HistoryRing paginates from before cursor", () => {
  const ring = new HistoryRing(10);

  ring.push([["a", 0]]);
  ring.push([["b", 0]]);
  ring.push([["c", 0]]);
  ring.push([["d", 0]]);

  const latest = ring.newestCursor();
  const page1 = ring.fetch(latest, 2);

  assert.equal(page1.lines.length, 2);
  assert.equal(page1.lines[0].segs[0][0], "c");
  assert.equal(page1.lines[1].segs[0][0], "d");

  const page2 = ring.fetch(page1.nextBefore, 2);
  assert.equal(page2.lines.length, 2);
  assert.equal(page2.lines[0].segs[0][0], "a");
  assert.equal(page2.lines[1].segs[0][0], "b");
  assert.equal(page2.exhausted, true);
});
