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

const usingWebProvider = config.whatsapp.provider === "web";
const usingManualWeb = usingWebProvider && config.whatsappWeb.mode === "manual";

if (!usingWebProvider) {
  console.log("[WhatsApp] CallMeBot mode enabled. QR login is disabled.");
} else if (usingManualWeb) {
  console.log("[WhatsApp] Manual web mode enabled. Browser automation is disabled.");
}

const require = createRequire(import.meta.url);
const { Client, LocalAuth, NoAuth } = usingWebProvider && !usingManualWeb
  ? require("whatsapp-web.js")
  : {};
const installChromeScript = usingWebProvider && !usingManualWeb
  ? fileURLToPath(new URL("../scripts/install-chrome.js", import.meta.url))
  : null;

function findChrome() {
  if (!usingWebProvider || usingManualWeb) {
    return null;
  }

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
  if (!usingWebProvider || usingManualWeb) {
    return;
  }

  if (!config.whatsappWeb.allowBundledBrowser) {
    console.warn("[WhatsApp] Bundled browser install disabled. Set WHATSAPP_WEB_ALLOW_BUNDLED_BROWSER=true to enable.");
    return;
  }

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
  if (!usingWebProvider || usingManualWeb) {
    return null;
  }

  if (config.whatsappWeb.authStrategy === "noauth") {
    console.log("[WhatsApp] Using NoAuth strategy for this environment.");
    return new NoAuth();
  }

  console.log("[WhatsApp] Using LocalAuth strategy.");
  return new LocalAuth({ dataPath: config.whatsappWeb.userDataDir });
}

let chromePath = config.whatsappWeb.executablePath || findChrome();

if (usingWebProvider && !usingManualWeb && !chromePath) {
  installChromeIfMissing();
  chromePath = config.whatsappWeb.executablePath || findChrome();
}

if (usingWebProvider && !usingManualWeb) {
  console.log("[WhatsApp] Chrome:", chromePath || `not found in ${CACHE_DIR}`);
}

if (usingWebProvider && !usingManualWeb && !chromePath) {
  throw new Error(
    `Could not find Chrome after install attempt. Set WHATSAPP_WEB_EXECUTABLE_PATH or verify Puppeteer browser installation in ${CACHE_DIR}.`
  );
}

let client = null;
let clientStatus = "disconnected";
let currentQR = null;

function getClient() {
  if (!usingWebProvider || usingManualWeb) {
    return null;
  }

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

if (!usingManualWeb) {
  getClient();
}

export async function getWhatsAppStatus() {
  if (!usingWebProvider) {
    return { loggedIn: true, status: "callmebot", provider: "callmebot" };
  }

  if (usingManualWeb) {
    return { loggedIn: true, status: "manual", provider: "web" };
  }

  return { loggedIn: clientStatus === "connected", status: clientStatus };
}

export async function getWhatsAppQR() {
  if (!usingWebProvider) {
    return { loggedIn: true, qr: null, provider: "callmebot" };
  }

  if (usingManualWeb) {
    return { loggedIn: true, qr: null, provider: "web", mode: "manual" };
  }

  if (clientStatus === "connected") return { loggedIn: true, qr: null };
  if (!client) getClient();
  return { loggedIn: false, qr: currentQR };
}

export async function resetWhatsAppClient() {
  if (!usingWebProvider) {
    return { loggedIn: true, qr: null, provider: "callmebot" };
  }

  if (usingManualWeb) {
    return { loggedIn: true, qr: null, provider: "web", mode: "manual" };
  }

  if (client) {
    try {
      await client.destroy();
    } catch (error) {
      console.warn("[WhatsApp] Failed to destroy client:", error.message || error);
    }
  }

  client = null;
  clientStatus = "disconnected";
  currentQR = null;

  getClient();
  return { loggedIn: false, qr: currentQR };
}

export async function sendWhatsAppWebMessage(record) {
  if (!usingWebProvider) {
    throw new Error("WhatsApp Web is disabled. Use the CallMeBot reminder flow instead.");
  }

  if (usingManualWeb) {
    return {
      mode: "manual",
      openUrl: buildWhatsAppWebUrl(record),
    };
  }

  if (clientStatus !== "connected")
    throw new Error("WhatsApp is not connected. Please scan the QR code first.");

  const phone = String(record.phoneNumber || "").trim().replace(/\D/g, "");
  if (!phone) throw new Error("Phone number is missing");

  await client.sendMessage(`${phone}@c.us`, buildReminderMessage(record));
  return { mode: "auto" };
}

function normalizePhoneForWeb(phoneNumber) {
  const raw = String(phoneNumber || "").trim();
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

function buildWhatsAppWebUrl(record) {
  const query = new URLSearchParams({
    phone: normalizePhoneForWeb(record.phoneNumber),
    text: buildReminderMessage(record),
  });
  return `https://web.whatsapp.com/send?${query.toString()}`;
}

export async function sendWhatsAppWebMessages(records) {
  if (!usingWebProvider) {
    throw new Error("WhatsApp Web is disabled. Use the CallMeBot reminder flow instead.");
  }

  if (usingManualWeb) {
    const openUrls = records
      .filter((record) => normalizePhoneForWeb(record.phoneNumber))
      .map((record) => buildWhatsAppWebUrl(record));
    return { openUrls, mode: "manual" };
  }

  if (clientStatus !== "connected")
    throw new Error("WhatsApp is not connected. Please scan the QR code first.");

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
