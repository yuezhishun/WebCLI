import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";
import type { WebSocket } from "ws";
import { parseCommand } from "./utils/command.js";
import { extractVisibleRows, lineToSegments } from "./term/extract.js";
import { HistoryRing } from "./term/history-ring.js";
import { StyleRegistry } from "./term/style-registry.js";
import type {
  ExitMessage,
  HistoryChunkMessage,
  InstanceSummary,
  PatchMessage,
  SnapshotMessage,
  WebCliInstance
} from "./types.js";

interface CreateInstanceInput {
  command: string;
  args?: string[];
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
}

interface InternalState {
  instance: WebCliInstance;
  history: HistoryRing;
  styles: StyleRegistry;
  writeQueue: Promise<void>;
  patchTimer: NodeJS.Timeout | null;
  pendingPatch: PatchMessage | null;
}

interface ManagerOptions {
  historyLimit: number;
}

const { Terminal } = xtermHeadless as unknown as {
  Terminal: new (options: {
    allowProposedApi?: boolean;
    cols: number;
    rows: number;
    scrollback: number;
  }) => any;
};

export class InstanceManager extends EventEmitter {
  private readonly instances = new Map<string, InternalState>();
  private readonly historyLimit: number;

  constructor(options: ManagerOptions) {
    super();
    this.historyLimit = options.historyLimit;
  }

  create(input: CreateInstanceInput): WebCliInstance {
    const id = randomUUID();
    const command = input.command?.trim() || "";
    const parsed = parseCommand(command);
    const cols = sanitizeDimension(input.cols, 80, 1, 500);
    const rows = sanitizeDimension(input.rows, 25, 1, 300);

    const term = new Terminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback: this.historyLimit
    });

    const nodePath = "C:\\Program Files\\nodejs";
    const defaultPath = process.env.PATH ? `${nodePath};${process.env.PATH}` : nodePath;
    
    const ptyProcess = pty.spawn(parsed.file, input.args || parsed.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: input.cwd || process.cwd(),
      env: {
        ...process.env,
        PATH: defaultPath,
        ...input.env
      },
      useConpty: false,
      windowsHide: true
    });

    const styles = new StyleRegistry();
    const visible = extractVisibleRows(term.buffer.active, cols, rows, styles);

    const instance: WebCliInstance = {
      id,
      command: command || parsed.file,
      pty: ptyProcess,
      term,
      clients: new Set<WebSocket>(),
      cols,
      rows,
      createdAt: new Date(),
      seq: 0,
      status: "running",
      lastVisibleSignatures: visible.signatures,
      lastBaseY: term.buffer.active.baseY,
      lastCursorX: 0,
      lastCursorY: 0
    };

    const state: InternalState = {
      instance,
      history: new HistoryRing(this.historyLimit),
      styles,
      writeQueue: Promise.resolve(),
      patchTimer: null,
      pendingPatch: null
    };

    ptyProcess.onData((data) => {
      state.writeQueue = state.writeQueue
        .then(() => this.applyPtyData(state, data))
        .catch((error: unknown) => {
          this.emit("error", error);
        });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      instance.status = "exited";
      const message: ExitMessage = {
        v: 1,
        type: "term.exit",
        instance_id: instance.id,
        code: exitCode,
        signal: signal === null ? null : String(signal),
        message: "Process completed"
      };

      this.emit("exit", instance.id, message);
      this.remove(instance.id, false);
    });

    this.instances.set(id, state);
    return instance;
  }

  list(): InstanceSummary[] {
    return [...this.instances.values()].map(({ instance }) => ({
      id: instance.id,
      command: instance.command,
      cols: instance.cols,
      rows: instance.rows,
      created_at: instance.createdAt.toISOString(),
      status: instance.status,
      clients: instance.clients.size
    }));
  }

  get(instanceId: string): WebCliInstance | null {
    return this.instances.get(instanceId)?.instance ?? null;
  }

  attachClient(instanceId: string, client: WebSocket): boolean {
    const state = this.instances.get(instanceId);
    if (!state) {
      return false;
    }

    state.instance.clients.add(client);
    return true;
  }

  detachClient(instanceId: string, client: WebSocket): void {
    const state = this.instances.get(instanceId);
    if (!state) {
      return;
    }

    state.instance.clients.delete(client);
  }

  terminate(instanceId: string): boolean {
    const state = this.instances.get(instanceId);
    if (!state) {
      return false;
    }

    state.instance.pty.kill();
    this.remove(instanceId, true);
    return true;
  }

  remove(instanceId: string, closeClients: boolean): void {
    const state = this.instances.get(instanceId);
    if (!state) {
      return;
    }

    if (closeClients) {
      for (const client of state.instance.clients) {
        safeSend(client, {
          v: 1,
          type: "term.exit",
          instance_id: instanceId,
          code: 0,
          signal: null,
          message: "Terminated by user"
        });
        client.close();
      }
    }

    // 清除定时器
    if (state.patchTimer) {
      clearTimeout(state.patchTimer);
      state.patchTimer = null;
    }

    state.instance.term.dispose();
    this.instances.delete(instanceId);
  }

  writeStdin(instanceId: string, data: string): boolean {
    const state = this.instances.get(instanceId);
    if (!state) {
      return false;
    }

    state.instance.pty.write(data);
    return true;
  }

  resize(instanceId: string, cols: number, rows: number): SnapshotMessage | null {
    const state = this.instances.get(instanceId);
    if (!state) {
      return null;
    }

    const safeCols = sanitizeDimension(cols, state.instance.cols, 1, 500);
    const safeRows = sanitizeDimension(rows, state.instance.rows, 1, 300);

    state.instance.cols = safeCols;
    state.instance.rows = safeRows;

    state.instance.pty.resize(safeCols, safeRows);
    state.instance.term.resize(safeCols, safeRows);

    state.history.clear();
    state.instance.lastBaseY = state.instance.term.buffer.active.baseY;
    state.instance.lastVisibleSignatures = extractVisibleRows(
      state.instance.term.buffer.active,
      safeCols,
      safeRows,
      state.styles
    ).signatures;

    return this.snapshot(instanceId, true);
  }

  snapshot(instanceId: string, advanceSeq: boolean): SnapshotMessage | null {
    const state = this.instances.get(instanceId);
    if (!state) {
      return null;
    }

    const active = state.instance.term.buffer.active;
    const visible = extractVisibleRows(active, state.instance.cols, state.instance.rows, state.styles);
    state.instance.lastVisibleSignatures = visible.signatures;

    if (advanceSeq) {
      state.instance.seq += 1;
    }

    return {
      v: 1,
      type: "term.snapshot",
      instance_id: state.instance.id,
      seq: state.instance.seq,
      ts: Date.now(),
      size: {
        cols: state.instance.cols,
        rows: state.instance.rows
      },
      cursor: {
        x: active.cursorX,
        y: active.cursorY - active.baseY,
        visible: active.cursorState === 1
      },
      styles: state.styles.snapshot(),
      rows: visible.rows,
      history: {
        available: state.history.size(),
        newest_cursor: state.history.newestCursor()
      }
    };
  }

  historyChunk(instanceId: string, reqId: string, before: string, limit: number): HistoryChunkMessage | null {
    const state = this.instances.get(instanceId);
    if (!state) {
      return null;
    }

    const result = state.history.fetch(before, limit);

    return {
      v: 1,
      type: "term.history.chunk",
      instance_id: instanceId,
      req_id: reqId,
      lines: result.lines.map((line) => ({ segs: line.segs })),
      next_before: result.nextBefore,
      exhausted: result.exhausted
    };
  }

  private async applyPtyData(state: InternalState, data: string): Promise<void> {
    await new Promise<void>((resolve) => {
      state.instance.term.write(data, () => resolve());
    });

    this.captureHistory(state);
    
    // 使用防抖机制，延迟发送patch消息
    if (state.patchTimer) {
      clearTimeout(state.patchTimer);
    }
    
    state.patchTimer = setTimeout(() => {
      const patch = this.buildPatchIfChanged(state);
      if (patch) {
        this.emit("patch", state.instance.id, patch);
      }
      state.patchTimer = null;
    }, 50);
  }

  private captureHistory(state: InternalState): void {
    const active = state.instance.term.buffer.active;
    const currentBaseY = active.baseY;

    if (currentBaseY < state.instance.lastBaseY) {
      state.history.clear();
      state.instance.lastBaseY = currentBaseY;
      return;
    }

    if (currentBaseY === state.instance.lastBaseY) {
      return;
    }

    for (let lineIndex = state.instance.lastBaseY; lineIndex < currentBaseY; lineIndex += 1) {
      const line = active.getLine(lineIndex);
      const segs = lineToSegments(line as any, state.instance.cols, state.styles);
      state.history.push(segs);
    }

    state.instance.lastBaseY = currentBaseY;
  }

  private buildPatchIfChanged(state: InternalState): PatchMessage | null {
    const active = state.instance.term.buffer.active;
    const visible = extractVisibleRows(active, state.instance.cols, state.instance.rows, state.styles);

    const changedRows = visible.rows.filter((row, index) => {
      return visible.signatures[index] !== state.instance.lastVisibleSignatures[index];
    });

    const cursorX = active.cursorX;
    const cursorY = active.cursorY - active.baseY;
    const cursorChanged = cursorX !== state.instance.lastCursorX || cursorY !== state.instance.lastCursorY;

    state.instance.lastVisibleSignatures = visible.signatures;
    state.instance.lastCursorX = cursorX;
    state.instance.lastCursorY = cursorY;

    if (changedRows.length === 0 && !cursorChanged) {
      return null;
    }

    state.instance.seq += 1;

    return {
      v: 1,
      type: "term.patch",
      instance_id: state.instance.id,
      seq: state.instance.seq,
      ts: Date.now(),
      cursor: {
        x: cursorX,
        y: cursorY,
        visible: active.cursorState === 1
      },
      styles: state.styles.snapshot(),
      rows: changedRows
    };
  }
}

function sanitizeDimension(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function safeSend(client: WebSocket, payload: unknown): void {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(payload));
  }
}
