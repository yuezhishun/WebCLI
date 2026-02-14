import type { Segment, TerminalRow } from "../types.js";
import { StyleRegistry } from "./style-registry.js";

interface BufferCellLike {
  getChars?: () => string;
  getWidth?: () => number;
}

interface BufferLineLike {
  getCell: (x: number) => (BufferCellLike & Record<string, unknown>) | undefined;
}

export function lineToSegments(line: BufferLineLike | undefined, cols: number, styles: StyleRegistry): Segment[] {
  if (!line) {
    return [["", 0]];
  }

  const segs: Segment[] = [];
  let currentStyle = -1;
  let currentText = "";

  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x);
    const width = typeof cell?.getWidth === "function" ? cell.getWidth() : 1;
    if (width === 0) {
      continue;
    }

    const text = typeof cell?.getChars === "function" ? cell.getChars() || " " : " ";
    const styleId = styles.getIdForCell(cell as any);

    if (styleId !== currentStyle) {
      if (currentText.length > 0) {
        segs.push([currentText, currentStyle < 0 ? 0 : currentStyle]);
      }
      currentStyle = styleId;
      currentText = text;
    } else {
      currentText += text;
    }
  }

  if (currentText.length > 0) {
    segs.push([currentText, currentStyle < 0 ? 0 : currentStyle]);
  }

  if (segs.length === 0) {
    return [["", 0]];
  }

  return trimRightSpaces(segs);
}

export function extractVisibleRows(
  buffer: any,
  cols: number,
  rows: number,
  styles: StyleRegistry
): { rows: TerminalRow[]; signatures: string[] } {
  const viewportStart = Math.max(0, buffer.baseY);
  const extracted: TerminalRow[] = [];
  const signatures: string[] = [];

  for (let y = 0; y < rows; y += 1) {
    const line = buffer.getLine(viewportStart + y) as BufferLineLike | undefined;
    const segs = lineToSegments(line, cols, styles);
    extracted.push({ y, segs });
    signatures.push(segs.map((seg) => `${seg[1]}:${seg[0]}`).join("|"));
  }

  return { rows: extracted, signatures };
}

function trimRightSpaces(segs: Segment[]): Segment[] {
  const copied: Segment[] = segs.map((seg) => [seg[0], seg[1]]);

  for (let i = copied.length - 1; i >= 0; i -= 1) {
    const [text] = copied[i];
    const trimmed = text.replace(/\s+$/g, "");
    if (trimmed.length === 0) {
      copied.pop();
      continue;
    }
    copied[i][0] = trimmed;
    break;
  }

  return copied.length === 0 ? [["", 0]] : copied;
}
