import type { Request, Response, NextFunction } from "express";

/** Single bearer token shared by Simulator/frontend/ops — demo-only, not a real auth system. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_BEARER_TOKEN;
  if (!expected) {
    next();
    return;
  }
  const header = req.header("authorization");
  if (header === `Bearer ${expected}`) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
