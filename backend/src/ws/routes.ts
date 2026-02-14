import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import type { InstanceManager } from "../instance-manager.js";
import { parseClientMessage } from "./messages.js";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function registerWsRoutes(app: FastifyInstance, manager: InstanceManager): Promise<void> {
  const pingTimer = setInterval(() => {
    for (const instance of manager.list()) {
      const ping = {
        v: 1,
        type: "ping",
        instance_id: instance.id,
        ts: Date.now()
      };

      const target = manager.get(instance.id);
      if (!target) {
        continue;
      }

      for (const client of target.clients) {
        safeSend(client, ping);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  app.addHook("onClose", async () => {
    clearInterval(pingTimer);
  });

  manager.on("patch", (instanceId: string, patch: unknown) => {
    const target = manager.get(instanceId);
    if (!target) {
      return;
    }

    for (const client of target.clients) {
      safeSend(client, patch);
    }
  });

  manager.on("exit", (instanceId: string, message: unknown) => {
    const target = manager.get(instanceId);
    if (!target) {
      return;
    }

    for (const client of target.clients) {
      safeSend(client, message);
      client.close();
    }
  });

  app.get(
    "/ws/term",
    {
      websocket: true
    },
    (connection, request) => {
      const socket = ((connection as any).socket ?? connection) as WebSocket;
      const instanceId = parseInstanceId(request.url || "");
      if (!instanceId) {
        socket.close(1008, "missing instance_id");
        return;
      }

      const attached = manager.attachClient(instanceId, socket);
      if (!attached) {
        socket.close(1008, "instance not found");
        return;
      }

      const snapshot = manager.snapshot(instanceId, true);
      if (snapshot) {
        safeSend(socket, snapshot);
      }

      socket.on("message", (raw: RawData) => {
        const payload = typeof raw === "string" ? raw : raw.toString();
        const message = parseClientMessage(payload);

        if (!message) {
          safeSend(socket, {
            error: "invalid message"
          });
          return;
        }

        if (message.instance_id !== instanceId) {
          safeSend(socket, {
            error: "instance mismatch"
          });
          return;
        }

        switch (message.type) {
          case "term.stdin":
            manager.writeStdin(instanceId, message.data);
            break;
          case "term.resize": {
            const resized = manager.resize(instanceId, message.size.cols, message.size.rows);
            if (resized) {
              safeSend(socket, resized);
            }
            break;
          }
          case "term.resync": {
            const snap = manager.snapshot(instanceId, true);
            if (snap) {
              safeSend(socket, snap);
            }
            break;
          }
          case "term.history.get": {
            const chunk = manager.historyChunk(instanceId, message.req_id, message.before, message.limit);
            if (chunk) {
              safeSend(socket, chunk);
            }
            break;
          }
          case "ping": {
            safeSend(socket, {
              v: 1,
              type: "pong",
              instance_id: instanceId,
              ts: Date.now()
            });
            break;
          }
          default:
            break;
        }
      });

      socket.on("close", () => {
        manager.detachClient(instanceId, socket);
      });
    }
  );
}

function parseInstanceId(url: string): string | null {
  const query = url.split("?")[1];
  if (!query) {
    return null;
  }

  const search = new URLSearchParams(query);
  const instanceId = search.get("instance_id");
  return instanceId && instanceId.trim().length > 0 ? instanceId : null;
}

function safeSend(client: WebSocket, payload: unknown): void {
  if (client.readyState === 1) {
    client.send(JSON.stringify(payload));
  }
}
