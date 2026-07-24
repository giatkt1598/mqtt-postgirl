import { ErrorRequestHandler } from "express";
import { z } from "zod";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: "Validation failed", issues: error.issues });
    return;
  }
  const message = error instanceof Error && error.message.trim() ? error.message : "Internal server error";
  const status = /already exists|duplicate|referenced by/i.test(message) ? 409 : /not found/i.test(message) ? 404 : 400;
  res.status(status).json({ message });
};
