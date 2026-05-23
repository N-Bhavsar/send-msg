import { createRequire } from "module";
import { execFileSync, execSync } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import qrcode from "qrcode";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

// Must be set BEFORE requiring whatsapp-web.js so its bundled puppeteer-core
// uses the same cache directory where chrome was installed
const CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
process.env.PUPPETEER_CACHE_DIR = CACHE_DIR;

const require = createRequire(import.meta.url);
const { Client, LocalAuth, NoAuth } = require("whatsapp-web.js");
const installChromeScript = fileURLToPath(new URL("../scripts/install-chrome.js", import.meta.url));

function findChrome() {
  try {
    const out = execSync(
      `find "${CACHE_DIR}" -type f \\( -name "chrome" -o -name "chromium" \\) 2>/dev/null | head -1`,
      { encoding: "utf8" }
    ).trim();
    if (out && existsSync(out)) return out;
  } catch { /* ignore */ }
  return null;
}

function installChromeIfMissing() {
  console.log("[WhatsApp] Chrome missing, installing Puppeteer browser...");
  execFileSync(process.execPath, [installChromeScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR: CACHE_DIR,
    },
  });
}

function resolveAuthStrategy() {
  if (config.whatsappWeb.authStrategy === "noauth") {
    console.log("[WhatsApp] Using NoAuth strategy for this environment.");
    return new NoAuth();
  }

  console.log("[WhatsApp] Using LocalAuth strategy.");
  return new LocalAuth({ dataPath: config.whatsappWeb.userDataDir });
}

let chromePath = config.whatsappWeb.executablePath || findChrome();

if (!chromePath) {
  installChromeIfMissing();
  chromePath = config.whatsappWeb.executablePath || findChrome();
}

console.log("[WhatsApp] Chrome:", chromePath || `not found in ${CACHE_DIR}`);

if (!chromePath) {
  throw new Error(
    `Could not find Chrome after install attempt. Set WHATSAPP_WEB_EXECUTABLE_PATH or verify Puppeteer browser installation in ${CACHE_DIR}.`
  );
}

let client = null;
let clientStatus = "disconnected";
let currentQR = null;

function getClient() {
  if (client) return client;

  client = new Client({
    authStrategy: resolveAuthStrategy(),
    puppeteer: {
      headless: config.whatsappWeb.headless,
      executablePath: chromePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    },
  });

  client.on("qr", async (qr) => {
    clientStatus = "qr";
    currentQR = await qrcode.toDataURL(qr);
    console.log("[WhatsApp] QR ready");
  });

  client.on("authenticated", () => {
    clientStatus = "connecting";
    currentQR = null;
    console.log("[WhatsApp] Authenticated");
  });

  client.on("ready", () => {
    clientStatus = "connected";
    currentQR = null;
    console.log("[WhatsApp] Ready");
  });

  client.on("disconnected", () => {
    clientStatus = "disconnected";
    currentQR = null;
    client = null;
    console.log("[WhatsApp] Disconnected");
  });

  client.initialize();
  return client;
}

getClient();

export async function getWhatsAppStatus() {
  return { loggedIn: clientStatus === "connected", status: clientStatus };
}

export async function getWhatsAppQR() {
  if (clientStatus === "connected") return { loggedIn: true, qr: null };
  if (!client) getClient();
  return { loggedIn: false, qr: currentQR };
}

export async function sendWhatsAppWebMessage(record) {
  if (clientStatus !== "connected")
    throw new Error("WhatsApp is not connected. Please scan the QR code first.");

  const phone = String(record.phoneNumber || "").trim().replace(/\D/g, "");
  if (!phone) throw new Error("Phone number is missing");

  await client.sendMessage(`${phone}@c.us`, buildReminderMessage(record));
}

export async function sendWhatsAppWebMessages(records) {
  let sentCount = 0;
  let failedCount = 0;

  for (const record of records) {
    try {
      await sendWhatsAppWebMessage(record);
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`WhatsApp send failed for ${record.phoneNumber}`, error.message);
    }
  }

  return { sentCount, failedCount };
}
