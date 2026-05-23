import dotenv from "dotenv";

dotenv.config();

const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const frontendUrl = rawFrontendUrl
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

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
  callmebot: {
    apiKey: process.env.CALLMEBOT_API_KEY,
  },
  whatsappWeb: {
    enabled: process.env.WHATSAPP_WEB_ENABLED !== "false",
    userDataDir: process.env.WHATSAPP_WEB_USER_DATA_DIR || "whatsapp-session",
    headless: process.env.WHATSAPP_WEB_HEADLESS === "true",
    executablePath:
      process.env.WHATSAPP_WEB_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "",
    loginTimeoutMs: Number(process.env.WHATSAPP_WEB_LOGIN_TIMEOUT_MS || 120000),
    sendDelayMs: Number(process.env.WHATSAPP_WEB_SEND_DELAY_MS || 1500),
  },
};
