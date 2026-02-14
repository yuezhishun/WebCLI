import type { FastifyInstance } from "fastify";
import type { InstanceManager } from "../instance-manager.js";

interface CreateInstanceBody {
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export async function registerApiRoutes(app: FastifyInstance, manager: InstanceManager): Promise<void> {
  app.get("/api/health", async () => {
    return {
      ok: true,
      now: new Date().toISOString(),
      instances: manager.list().length
    };
  });

  app.get("/api/instances", async () => {
    return {
      items: manager.list()
    };
  });

  app.post<{ Body: CreateInstanceBody }>("/api/instances", async (request, reply) => {
    try {
      const body = request.body || {};
      const command = typeof body.command === "string" ? body.command : "";

      if (command.trim().length === 0) {
        reply.code(400);
        return {
          error: "command is required"
        };
      }

      const instance = manager.create({
        command,
        args: body.args,
        cols: body.cols ?? 80,
        rows: body.rows ?? 25,
        cwd: body.cwd,
        env: body.env
      });

      const protocol = request.protocol === "https" ? "wss" : "ws";
      const wsUrl = `${protocol}://${request.hostname}/ws/term?instance_id=${encodeURIComponent(instance.id)}`;

      return {
        instance_id: instance.id,
        ws_url: wsUrl
      };
    } catch (error) {
      reply.code(500);
      return {
        error: "Failed to create instance",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  });

  app.delete<{ Params: { id: string } }>("/api/instances/:id", async (request, reply) => {
    const ok = manager.terminate(request.params.id);
    if (!ok) {
      reply.code(404);
      return {
        error: "instance not found"
      };
    }

    return { ok: true };
  });
}
