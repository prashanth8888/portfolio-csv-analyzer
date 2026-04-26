import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";

import { analyzeUploadedFiles, MAX_UPLOAD_FILES } from "../analysis/ingest.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: 10 * 1024 * 1024
  }
});

export function createAnalyzeRouter() {
  const router = Router();

  router.post("/analyze", upload.array("files", MAX_UPLOAD_FILES), handleAnalyzeRequest);

  return router;
}

export async function handleAnalyzeRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const files = ((request.files as Express.Multer.File[] | undefined) ?? []).filter(Boolean);

    if (files.length === 0) {
      response.status(400).json({ error: "Attach between 1 and 10 CSV or PDF files using the files field." });
      return;
    }

    const analysis = await analyzeUploadedFiles(files);
    response.json(analysis);
  } catch (error) {
    next(error);
  }
}

export function analyzeErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_COUNT") {
      response.status(400).json({ error: `Attach no more than ${MAX_UPLOAD_FILES} files per request.` });
      return;
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      response.status(400).json({ error: "One or more files exceeded the 10 MB upload limit." });
      return;
    }

    response.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof Error) {
    response.status(500).json({ error: error.message });
    return;
  }

  next(error);
}
