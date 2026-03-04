import express from "express";
import cors from "cors";
import { config } from "./config";
import { jobsRouter } from "./routes/jobs";
import { slackRouter } from "./routes/slack";
import { pool } from "./db";

const app = express();

// ── Middleware ──────────────────────────────────────────

// Capture raw body for Slack signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(express.urlencoded({ extended: true, verify: (req: any, _res, buf) => {
  req.rawBody = buf.toString();
}}));
app.use(cors({
  origin: [config.WEB_URL, "http://localhost:1259", "http://localhost:3000"],
  credentials: true,
}));

// ── Routes ─────────────────────────────────────────────

app.use("/api/jobs", jobsRouter);
app.use("/api/slack", slackRouter);

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: "unhealthy" });
  }
});

// ── Start ──────────────────────────────────────────────

app.listen(config.API_PORT, () => {
  console.log(`[api] Listening on port ${config.API_PORT}`);
  console.log(`[api] Environment: ${config.NODE_ENV}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[api] SIGTERM received, shutting down...");
  await pool.end();
  process.exit(0);
});
