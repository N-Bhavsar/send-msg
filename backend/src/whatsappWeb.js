import { createRequire } from "module";
import { execSync } from "child_process";
import { existsSync } from "fs";
import qrcode from "qrcode";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

// Must be set BEFORE requiring whatsapp-web.js so its bundled puppeteer-core
// uses the same cache directory where chrome was installed
const CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
process.env.PUPPETEER_CACHE_DIR = CACHE_DIR;

const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require("whatsapp-web.js");

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

const chromePath = findChrome();
console.log("[WhatsApp] Chrome:", chromePath || `not found in ${CACHE_DIR}`);

let client = null;
let clientStatus = "disconnected";
let currentQR = null;

function getClient() {
  if (client) return client;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsappWeb.userDataDir }),
    puppeteer: {
      headless: true,
      executablePath: chromePath || undefined,
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
