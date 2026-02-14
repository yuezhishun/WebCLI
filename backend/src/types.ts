import type { IPty } from "node-pty";
import type { Terminal } from "@xterm/headless";
import type { WebSocket } from "ws";

export type Segment = [string, number];

export interface TerminalRow {
  y: number;
  segs: Segment[];
}

export interface StyleDefinition {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

export interface HistoryLine {
  cursor: string;
  segs: Segment[];
}

export interface SnapshotMessage {
  v: 1;
  type: "term.snapshot";
  instance_id: string;
  seq: number;
  ts: number;
  size: {
    cols: number;
    rows: number;
  };
  cursor: {
    x: number;
    y: number;
    visible: boolean;
  };
  styles: Record<string, StyleDefinition>;
  rows: TerminalRow[];
  history: {
    available: number;
    newest_cursor: string;
  };
}

export interface PatchMessage {
  v: 1;
  type: "term.patch";
  instance_id: string;
  seq: number;
  ts: number;
  cursor: {
    x: number;
    y: number;
    visible: boolean;
  };
  styles: Record<string, StyleDefinition>;
  rows: TerminalRow[];
}

export interface ExitMessage {
  v: 1;
  type: "term.exit";
  instance_id: string;
  code: number;
  signal: string | null;
  message: string;
}

export interface HistoryChunkMessage {
  v: 1;
  type: "term.history.chunk";
  instance_id: string;
  req_id: string;
  lines: Array<{ segs: Segment[] }>;
  next_before: string;
  exhausted: boolean;
}

export interface InstanceSummary {
  id: string;
  command: string;
  cols: number;
  rows: number;
  created_at: string;
  status: "running" | "exited";
  clients: number;
}

export interface WebCliInstance {
  id: string;
  command: string;
  pty: IPty;
  term: Terminal;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  createdAt: Date;
  seq: number;
  status: "running" | "exited";
  lastVisibleSignatures: string[];
  lastBaseY: number;
  lastCursorX: number;
  lastCursorY: number;
}
