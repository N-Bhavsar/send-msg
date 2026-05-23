import puppeteer from "puppeteer";
import { execFile } from "node:child_process";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const execFileAsync = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return; }
      resolve({ stdout, stderr });
    });
  });

let browserInstallPromise = null;

async function ensureChromeBrowserInstalled() {
  if (!browserInstallPromise) {
    browserInstallPromise = execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", [
      "exec", "puppeteer", "browsers", "install", "chrome",
    ]).catch((error) => { browserInstallPromise = null; throw error; });
  }
  return browserInstallPromise;
}

function isMissingChromeError(error) {
  return /Could not find Chrome|Could not find Chromium|Browser was not found/i.test(String(error?.message || ""));
}

async function applyStealthToPage(page) {
  await page.setUserAgent(USER_AGENT);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
  });
}

// Shared browser singleton
let sharedBrowser = null;
let browserLaunchPromise = null;

async function getSharedBrowser() {
  if (sharedBrowser) {
    try { await sharedBrowser.pages(); return sharedBrowser; } catch {
      sharedBrowser = null; browserLaunchPromise = null;
    }
  }

  if (!browserLaunchPromise) {
    const launchOptions = {
      headless: true,
      userDataDir: config.whatsappWeb.userDataDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1280,800",
      ],
    };
    if (config.whatsappWeb.executablePath) {
      launchOptions.executablePath = config.whatsappWeb.executablePath;
    }

    browserLaunchPromise = (async () => {
      try {
        sharedBrowser = await puppeteer.launch(launchOptions);
      } catch (error) {
        if (!config.whatsappWeb.executablePath && isMissingChromeError(error)) {
          console.warn("Chrome missing — installing and retrying.");
          await ensureChromeBrowserInstalled();
          sharedBrowser = await puppeteer.launch(launchOptions);
        } else {
          throw error;
        }
      } finally {
        browserLaunchPromise = null;
      }
      sharedBrowser.on("disconnected", () => {
        sharedBrowser = null;
        browserLaunchPromise = null;
        sessionPage = null;
      });
      return sharedBrowser;
    })();
  }

  return browserLaunchPromise;
}

// Serial task queue
let taskQueue = Promise.resolve();
function enqueue(fn) {
  taskQueue = taskQueue.then(fn, fn);
  return taskQueue;
}

// Persistent session page — stays open so WhatsApp session is maintained
let sessionPage = null;

async function getSessionPage() {
  const browser = await getSharedBrowser();

  if (sessionPage && !sessionPage.isClosed()) {
    return sessionPage;
  }

  sessionPage = await browser.newPage();
  await applyStealthToPage(sessionPage);
  await sessionPage.goto("https://web.whatsapp.com", { waitUntil: "networkidle2" });
  return sessionPage;
}

export async function getWhatsAppStatus() {
  const page = await getSessionPage();
  const loggedIn = await page.evaluate(() =>
    Boolean(document.querySelector("#side") ||
      document.querySelector("div[data-testid='chat-list']"))
  );
  return { loggedIn };
}

export async function getWhatsAppQR() {
  const page = await getSessionPage();

  // Check if already logged in
  const loggedIn = await page.evaluate(() =>
    Boolean(document.querySelector("#side") ||
      document.querySelector("div[data-testid='chat-list']"))
  );
  if (loggedIn) return { loggedIn: true, qr: null };

  // Wait up to 20s for page to fully render
  await new Promise((r) => setTimeout(r, 5000));

  // Return a full screenshot — works regardless of how WhatsApp renders the QR
  const screenshot = await page.screenshot({ encoding: "base64", type: "png" });
  return { loggedIn: false, qr: `data:image/png;base64,${screenshot}` };
}

function normalizePhoneForWeb(phoneNumber) {
  return String(phoneNumber || "").trim().replace(/\D/g, "");
}

function buildWhatsAppWebUrl(phoneNumber, message) {
  const query = new URLSearchParams({ phone: normalizePhoneForWeb(phoneNumber), text: message });
  return `https://web.whatsapp.com/send?${query.toString()}`;
}

async function waitForChatInput(page, timeoutMs) {
  await page.waitForSelector("div[role='textbox']", { timeout: timeoutMs });
}

async function handleUseHereDialog(page) {
  try {
    await page.waitForFunction(
      () => {
        const btn = Array.from(document.querySelectorAll("button, a")).find(
          (b) => b.textContent?.trim().toLowerCase() === "use here"
        );
        if (btn) { btn.click(); return true; }
        return false;
      },
      { timeout: 5000 }
    );
  } catch { /* dialog not present */ }
}

async function sendMessageOnPage(page, delayMs) {
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, delayMs));
}

async function waitForSendConfirmation(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const msgs = document.querySelectorAll("div.message-out");
      if (!msgs.length) return false;
      const last = msgs[msgs.length - 1];
      return Boolean(last.querySelector(
        "span[data-icon='msg-check'], span[data-icon='msg-dblcheck'], span[data-icon='msg-dblcheck-ack']"
      ));
    },
    { timeout: timeoutMs }
  );
}

export async function sendWhatsAppWebMessage(record) {
  if (!config.whatsappWeb.enabled) throw new Error("WhatsApp Web automation is disabled");
  const phone = record.phoneNumber || "";
  if (!phone.trim()) throw new Error("Phone number is missing");

  return enqueue(async () => {
    const message = buildReminderMessage(record);
    const url = buildWhatsAppWebUrl(phone, message);

    // Reuse the session page for sending — it already has the authenticated session
    const page = await getSessionPage();
    await page.goto(url, { waitUntil: "networkidle2" });
    await handleUseHereDialog(page);
    await waitForChatInput(page, config.whatsappWeb.loginTimeoutMs);
    await sendMessageOnPage(page, config.whatsappWeb.sendDelayMs);
    await waitForSendConfirmation(page, config.whatsappWeb.loginTimeoutMs);

    // Return to WhatsApp home so session page stays on a stable state
    await page.goto("https://web.whatsapp.com", { waitUntil: "networkidle2" });
  });
}

export async function sendWhatsAppWebMessages(records) {
  if (!config.whatsappWeb.enabled) throw new Error("WhatsApp Web automation is disabled");

  let sentCount = 0;
  let failedCount = 0;

  for (const record of records) {
    const phone = record.phoneNumber || "";
    if (!phone.trim()) { failedCount += 1; continue; }
    try {
      await sendWhatsAppWebMessage(record);
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`WhatsApp Web send failed for ${phone}`, error.message);
    }
  }

  return { sentCount, failedCount };
}
