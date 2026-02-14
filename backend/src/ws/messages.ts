export interface StdinMessage {
  v: 1;
  type: "term.stdin";
  instance_id: string;
  data: string;
}

export interface ResizeMessage {
  v: 1;
  type: "term.resize";
  instance_id: string;
  req_id: string;
  size: {
    cols: number;
    rows: number;
  };
}

export interface HistoryGetMessage {
  v: 1;
  type: "term.history.get";
  instance_id: string;
  req_id: string;
  before: string;
  limit: number;
}

export interface ResyncMessage {
  v: 1;
  type: "term.resync";
  instance_id: string;
  req_id: string;
  reason: "seq_gap" | "decode_error" | "client_backpressure" | "manual";
  last_seq?: number;
}

export interface PingMessage {
  v: 1;
  type: "ping";
  instance_id: string;
  ts?: number;
}

export type ClientMessage =
  | StdinMessage
  | ResizeMessage
  | HistoryGetMessage
  | ResyncMessage
  | PingMessage;

export function parseClientMessage(input: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const maybe = parsed as Record<string, unknown>;
  if (maybe.v !== 1 || typeof maybe.type !== "string") {
    return null;
  }

  switch (maybe.type) {
    case "term.stdin":
      if (typeof maybe.instance_id === "string" && typeof maybe.data === "string") {
        return {
          v: 1,
          type: "term.stdin",
          instance_id: maybe.instance_id,
          data: maybe.data
        };
      }
      return null;
    case "term.resize":
      if (
        typeof maybe.instance_id === "string" &&
        typeof maybe.req_id === "string" &&
        isSize(maybe.size)
      ) {
        return {
          v: 1,
          type: "term.resize",
          instance_id: maybe.instance_id,
          req_id: maybe.req_id,
          size: maybe.size
        };
      }
      return null;
    case "term.history.get":
      if (
        typeof maybe.instance_id === "string" &&
        typeof maybe.req_id === "string" &&
        typeof maybe.before === "string" &&
        typeof maybe.limit === "number"
      ) {
        return {
          v: 1,
          type: "term.history.get",
          instance_id: maybe.instance_id,
          req_id: maybe.req_id,
          before: maybe.before,
          limit: maybe.limit
        };
      }
      return null;
    case "term.resync":
      if (
        typeof maybe.instance_id === "string" &&
        typeof maybe.req_id === "string" &&
        isResyncReason(maybe.reason)
      ) {
        return {
          v: 1,
          type: "term.resync",
          instance_id: maybe.instance_id,
          req_id: maybe.req_id,
          reason: maybe.reason,
          last_seq: typeof maybe.last_seq === "number" ? maybe.last_seq : undefined
        };
      }
      return null;
    case "ping":
      if (typeof maybe.instance_id === "string") {
        return {
          v: 1,
          type: "ping",
          instance_id: maybe.instance_id,
          ts: typeof maybe.ts === "number" ? maybe.ts : undefined
        };
      }
      return null;
    default:
      return null;
  }
}

function isSize(value: unknown): value is { cols: number; rows: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return typeof obj.cols === "number" && typeof obj.rows === "number";
}

function isResyncReason(value: unknown): value is ResyncMessage["reason"] {
  return (
    value === "seq_gap" ||
    value === "decode_error" ||
    value === "client_backpressure" ||
    value === "manual"
  );
}
