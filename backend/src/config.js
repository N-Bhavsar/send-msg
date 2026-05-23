import dotenv from "dotenv";
import { existsSync } from "node:fs";

dotenv.config();

const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const frontendUrl = rawFrontendUrl
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const whatsappProvider =
  process.env.WHATSAPP_PROVIDER || "web";

const rawExecutablePath =
  process.env.WHATSAPP_WEB_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "";
const commonLinuxChromePaths = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

function resolveExecutablePath() {
  if (rawExecutablePath && existsSync(rawExecutablePath)) {
    return rawExecutablePath;
  }

  for (const candidate of commonLinuxChromePaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

const executablePath = resolveExecutablePath();

if (rawExecutablePath && !executablePath) {
  console.warn(
    `Configured Chrome executable path not found: ${rawExecutablePath}. Falling back to Puppeteer default.`
  );
} else if (!rawExecutablePath && !executablePath) {
  console.warn(
    "No Chrome/Chromium executable was found on this machine. WhatsApp Web automation will rely on Puppeteer's downloaded browser."
  );
}

export const config = {
  port: process.env.PORT || 5000,
  frontendUrl,
  auth: {
    username: "kikani uday",
    password: "Jainam@2003",
    token: "demo-admin-token",
  },
  reminderWindowDays: 3,
  reminderRunOnStartup: process.env.REMINDER_RUN_ON_STARTUP === "true",
  whatsapp: {
    provider: whatsappProvider,
  },
  whatsappWeb: {
    enabled: whatsappProvider === "web" && process.env.WHATSAPP_WEB_ENABLED !== "false",
    authStrategy:
      process.env.WHATSAPP_WEB_AUTH_STRATEGY || (process.env.RENDER === "true" ? "noauth" : "localauth"),
    userDataDir:
      process.env.WHATSAPP_WEB_USER_DATA_DIR ||
      (process.platform === "linux" ? "/tmp/whatsapp-session" : "whatsapp-session"),
    headless: process.env.WHATSAPP_WEB_HEADLESS !== "false",
    executablePath,
    loginTimeoutMs: Number(process.env.WHATSAPP_WEB_LOGIN_TIMEOUT_MS || 120000),
    sendDelayMs: Number(process.env.WHATSAPP_WEB_SEND_DELAY_MS || 1500),
  },
};
