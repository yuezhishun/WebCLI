import path from "node:path";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { InstanceManager } from "./instance-manager.js";
import { registerApiRoutes } from "./api/routes.js";
import { registerWsRoutes } from "./ws/routes.js";

const config = loadConfig();
const app = Fastify({
  logger: true
});

const manager = new InstanceManager({
  historyLimit: config.historyLimit
});

manager.on("error", (error) => {
  app.log.error({ err: error }, "instance manager error");
});

await app.register(fastifyCors, {
  origin: true
});

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, {
  root: path.join(process.cwd(), "frontend", "public")
});

await registerApiRoutes(app, manager);
await registerWsRoutes(app, manager);

app.get("/", async (_request, reply) => {
  return reply.sendFile("index.html");
});

const start = async (): Promise<void> => {
  try {
    await app.listen({
      host: config.host,
      port: config.port
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
