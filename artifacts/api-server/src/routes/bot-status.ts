import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { stats } from "../bot/index.js";

const router: IRouter = Router();

/**
 * Simple bearer-token guard.
 * Set BOT_STATUS_TOKEN env var to require authentication on this endpoint.
 * If the env var is not set the endpoint is disabled entirely.
 */
function requireStatusToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env["BOT_STATUS_TOKEN"];
  if (!token) {
    // No token configured — disable the endpoint to avoid data exposure
    res.status(404).json({ error: "Not found" });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (provided !== token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.get("/bot/status", requireStatusToken, (_req, res) => {
  res.json({
    started: stats.started,
    uptime: Math.floor((Date.now() - stats.started.getTime()) / 1000),
    membersChecked: stats.membersChecked,
    accountsBanned: stats.accountsBanned,
    accountsFlagged: stats.accountsFlagged,
    recentActions: stats.recentActions.slice(0, 20),
  });
});

export default router;
