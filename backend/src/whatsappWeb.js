import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

const CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
process.env.PUPPETEER_CACHE_DIR = CACHE_DIR;

const installChromeScript = fileURLToPath(new URL("../scripts/install-chrome.js", import.meta.url));

function normalizePhoneForWeb(phoneNumber) {
  const raw = String(phoneNumber || "").trim();
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

function buildWhatsAppWebUrl(phoneNumber, message) {
  const query = new URLSearchParams({
    phone: normalizePhoneForWeb(phoneNumber),
    text: message,
  });

  return `https://web.whatsapp.com/send?${query.toString()}`;
}

function buildCallMeBotUrl(phoneNumber, message) {
  const query = new URLSearchParams({
    phone: String(phoneNumber || "").trim(),
    text: message,
    apikey: config.whatsapp.callMeBotApiKey,
  });

  return `https://api.callmebot.com/whatsapp.php?${query.toString()}`;
}

function findBrowserInDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    return "";
  }

  const entries = readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = `${directoryPath}/${entry.name}`;
    if (entry.isFile() && entry.name === "chrome") {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const nested = findBrowserInDirectory(entryPath);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function findChrome() {
  const candidates = [
    config.whatsappWeb.executablePath,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const cacheBrowser = findBrowserInDirectory(CACHE_DIR);
  if (cacheBrowser) {
    return cacheBrowser;
  }

  try {
    const puppeteerBrowserPath = puppeteer.executablePath();
    if (puppeteerBrowserPath && existsSync(puppeteerBrowserPath)) {
      return puppeteerBrowserPath;
    }
  } catch {
    // Ignore and fall back to the install failure below.
  }

  return "";
}

function installChromeIfMissing() {
  if (findChrome()) {
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

async function ensureChrome() {
  let chromePath = findChrome();
  if (!chromePath) {
    installChromeIfMissing();
    chromePath = findChrome();
  }

  if (!chromePath) {
    throw new Error(
      `Could not find Chrome after install attempt. Set WHATSAPP_WEB_EXECUTABLE_PATH or verify Puppeteer browser installation in ${CACHE_DIR}.`
    );
  }

  return chromePath;
}

async function waitForChatInput(page, timeoutMs) {
  await page.waitForSelector("div[role='textbox']", { timeout: timeoutMs });
}

async function handleUseHereDialog(page) {
  try {
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll("button, a"));
        const useHere = buttons.find(
          (button) => button.textContent && button.textContent.trim().toLowerCase() === "use here"
        );
        if (useHere) {
          useHere.click();
          return true;
        }
        return false;
      },
      { timeout: 5000 }
    );
  } catch {
    // Ignore when the dialog is not shown.
  }
}

async function sendMessageOnPage(page, delayMs) {
  await page.waitForFunction(
    () => {
      const selectors = [
        "button[data-testid='compose-btn-send']",
        "button[aria-label*='Send']",
        "button span[data-icon='send']",
      ];

      return selectors.some((selector) => document.querySelector(selector));
    },
    { timeout: delayMs }
  ).catch(() => {});

  const sendSelectors = [
    "button[data-testid='compose-btn-send']",
    "button[aria-label*='Send']",
    "button span[data-icon='send']",
  ];

  for (const selector of sendSelectors) {
    const element = await page.$(selector);
    if (element) {
      await element.click();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return;
    }
  }

  await page.focus("div[role='textbox']");
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForSendConfirmation(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const outMessages = document.querySelectorAll("div.message-out");
      if (!outMessages.length) return false;

      const last = outMessages[outMessages.length - 1];
      return Boolean(
        last.querySelector(
          "span[data-icon='msg-check'], span[data-icon='msg-dblcheck'], span[data-icon='msg-dblcheck-ack']"
        )
      );
    },
    { timeout: timeoutMs }
  );
}

async function sendRecordWithBrowser(record) {
  const phone = record.phoneNumber || "";
  const message = buildReminderMessage(record);
  const url = buildWhatsAppWebUrl(phone, message);

  if (!phone.trim()) {
    throw new Error("Phone number is missing");
  }

  const chromePath = await ensureChrome();
  console.log(
    `[WhatsApp] Launching browser. headless=${config.whatsappWeb.headless} executablePath=${chromePath} userDataDir=${config.whatsappWeb.userDataDir}`
  );
  const browser = await puppeteer.launch({
    headless: config.whatsappWeb.headless,
    executablePath: chromePath,
    userDataDir: config.whatsappWeb.userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1200,800",
    ],
  });

  try {
    const page = await browser.newPage();
    // Evasion: set a normal user agent and overwrite automation flags
    const userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1200, height: 800 });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      window.navigator.chrome = { runtime: {} };
    });
    await page.goto(url, { waitUntil: "networkidle2" });
    await handleUseHereDialog(page);
    await waitForChatInput(page, config.whatsappWeb.loginTimeoutMs);
    await sendMessageOnPage(page, config.whatsappWeb.sendDelayMs);
    await waitForSendConfirmation(page, config.whatsappWeb.loginTimeoutMs);
  } finally {
    await browser.close();
  }
}

async function sendRecordWithCallMeBot(record) {
  if (!config.whatsapp.callMeBotApiKey) {
    throw new Error(
      "CALLMEBOT_API_KEY is required when WHATSAPP_PROVIDER is set to callmebot or when running on Render."
    );
  }

  const phone = String(record.phoneNumber || "").trim();
  const message = buildReminderMessage(record);

  if (!phone) {
    throw new Error("Phone number is missing");
  }

  const response = await fetch(buildCallMeBotUrl(phone, message));
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || `CallMeBot request failed with status ${response.status}`);
  }

  return { provider: "callmebot", response: body };
}

async function sendRecord(record) {
  if (config.whatsapp.provider === "callmebot") {
    return sendRecordWithCallMeBot(record);
  }

  return sendRecordWithBrowser(record);
}

export async function getWhatsAppStatus() {
  return {
    enabled:
      config.whatsapp.provider === "callmebot"
        ? Boolean(config.whatsapp.callMeBotApiKey)
        : config.whatsappWeb.enabled,
    provider: config.whatsapp.provider,
    status: "available",
  };
}

export async function getWhatsAppQR() {
  if (config.whatsapp.provider === "callmebot") {
    return {
      enabled: true,
      qr: null,
      provider: "callmebot",
      message: "CallMeBot mode does not use QR login.",
    };
  }

  return {
    enabled: true,
    qr: null,
    provider: "web",
    message: "QR flow is disabled. Sending uses direct WhatsApp Web automation.",
  };
}

export async function sendWhatsAppWebMessage(record) {
  await sendRecord(record);
}

export async function sendWhatsAppWebMessages(records) {
  let sentCount = 0;
  let failedCount = 0;
  const sentRecords = [];
  const failedRecords = [];

  for (const record of records) {
    try {
      await sendWhatsAppWebMessage(record);
      sentCount += 1;
      sentRecords.push(record);
    } catch (error) {
      failedCount += 1;
      failedRecords.push({ record, error: error?.message || String(error) });
      console.error(`WhatsApp Web send failed for ${record.phoneNumber}`, error.message);
    }
  }

  return { sentCount, failedCount, sentRecords, failedRecords };
}
