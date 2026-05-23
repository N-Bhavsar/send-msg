import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
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
  const browser = await puppeteer.launch({
    headless: config.whatsappWeb.headless,
    executablePath: chromePath,
    userDataDir: config.whatsappWeb.userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });
    await handleUseHereDialog(page);
    await waitForChatInput(page, config.whatsappWeb.loginTimeoutMs);
    await sendMessageOnPage(page, config.whatsappWeb.sendDelayMs);
    await waitForSendConfirmation(page, config.whatsappWeb.loginTimeoutMs);
  } finally {
    await browser.close();
  }
}

export async function getWhatsAppStatus() {
  return {
    enabled: true,
    provider: "web",
    status: "available",
  };
}

export async function getWhatsAppQR() {
  return {
    enabled: true,
    qr: null,
    provider: "web",
    message: "QR flow is disabled. Sending uses direct WhatsApp Web automation.",
  };
}

export async function sendWhatsAppWebMessage(record) {
  await sendRecordWithBrowser(record);
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
      console.error(`WhatsApp Web send failed for ${record.phoneNumber}`, error.message);
    }
  }

  return { sentCount, failedCount };
}
