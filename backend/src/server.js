import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { buildRouter } from "./routes.js";
import { startReminderScheduler } from "./reminder.js";

const app = express();

app.use(
  cors({
    origin: config.frontendUrl,
  })
);
app.use(express.json());

app.use("/api", buildRouter());

app.use((err, _req, res, _next) => {
  if (err?.message?.includes("Only .xlsx and .csv")) {
    return res.status(400).json({ message: err.message });
  }

  return res.status(500).json({ message: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});

startReminderScheduler();
