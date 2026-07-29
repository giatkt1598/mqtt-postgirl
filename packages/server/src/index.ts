import "reflect-metadata";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "./app";
import { initializeDatabase } from "./database/data-source";
import { AppRepositories } from "./repositories";
import { RealtimeEvent, RuntimeService } from "./runtime";

async function main() {
  // TypeORM owns schema creation and migrations before the HTTP server starts.
  const dataSource = await initializeDatabase();
  const repositories = new AppRepositories(dataSource);

  const sockets = new Set<WebSocket>();
  const broadcaster = (event: RealtimeEvent) => {
    const payload = JSON.stringify(event);
    for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(payload);
  };
  const runtime = new RuntimeService(repositories, broadcaster);
  const app = createApp(dataSource, runtime);

  const webDist = path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api") || (req.method !== "GET" && req.method !== "HEAD")) return next();
      return res.sendFile(path.join(webDist, "index.html"));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    sockets.add(socket);
    void repositories.bootstrap().then((payload) => socket.send(JSON.stringify({ type: "bootstrap", payload })));
    socket.on("close", () => sockets.delete(socket));
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`MQTT - PostGirl running on http://localhost:${port}`));
}

main().catch((error) => {
  console.error("Unable to start MQTT - PostGirl", error);
  process.exitCode = 1;
});
