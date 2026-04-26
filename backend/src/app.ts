import cors from "cors";
import express from "express";

import { analyzeErrorHandler, createAnalyzeRouter } from "./routes/analyze.ts";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api", createAnalyzeRouter());
  app.use(analyzeErrorHandler);

  return app;
}
