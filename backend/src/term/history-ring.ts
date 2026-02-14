import type { HistoryLine, Segment } from "../types.js";

export class HistoryRing {
  private readonly capacity: number;
  private readonly items: HistoryLine[] = [];
  private cursorCounter = 1;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  push(segs: Segment[]): void {
    const line: HistoryLine = {
      cursor: this.makeCursor(this.cursorCounter++),
      segs
    };

    this.items.push(line);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  clear(): void {
    this.items.length = 0;
  }

  size(): number {
    return this.items.length;
  }

  newestCursor(): string {
    // Returns the cursor position "after the latest line" so callers can
    // request older lines with a strict `< before` query.
    return this.makeCursor(this.cursorCounter);
  }

  // Returns up to `limit` lines older than cursor `before`.
  fetch(before: string, limit: number): { lines: HistoryLine[]; nextBefore: string; exhausted: boolean } {
    const beforeNum = this.parseCursor(before);
    const safeLimit = Math.max(1, Math.min(200, limit));
    const oldestCursorNum =
      this.items.length > 0 ? this.parseCursor(this.items[0].cursor) : Number.MAX_SAFE_INTEGER;
    const effectiveBefore = beforeNum <= oldestCursorNum ? this.cursorCounter : beforeNum;

    const candidates = this.items.filter((item) => this.parseCursor(item.cursor) < effectiveBefore);
    const lines = candidates.slice(Math.max(0, candidates.length - safeLimit));

    if (lines.length === 0) {
      return {
        lines: [],
        nextBefore: this.makeCursor(effectiveBefore),
        exhausted: candidates.length === 0
      };
    }

    const nextBefore = lines[0].cursor;
    const exhausted = candidates.length <= lines.length;

    return { lines, nextBefore, exhausted };
  }

  private makeCursor(num: number): string {
    return `h-${num}`;
  }

  private parseCursor(cursor: string): number {
    if (!cursor.startsWith("h-")) {
      return Number.MAX_SAFE_INTEGER;
    }
    const parsed = Number.parseInt(cursor.slice(2), 10);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }
}
