import puppeteer from "puppeteer";
import { execFile } from "node:child_process";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

const execFileAsync = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

let browserInstallPromise = null;

async function ensureChromeBrowserInstalled() {
  if (!browserInstallPromise) {
    browserInstallPromise = execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", [
      "exec", "puppeteer", "browsers", "install", "chrome",
    ]).catch((error) => {
      browserInstallPromise = null;
      throw error;
    });
  }
  return browserInstallPromise;
}

function isMissingChromeError(error) {
  const message = String(error?.message || "");
  return /Could not find Chrome|Could not find Chromium|Browser was not found/i.test(message);
}

// Shared browser singleton
let sharedBrowser = null;
let browserLaunchPromise = null;

async function getSharedBrowser() {
  if (sharedBrowser) {
    try {
      // Verify it's still alive
      await sharedBrowser.pages();
      return sharedBrowser;
    } catch {
      sharedBrowser = null;
      browserLaunchPromise = null;
    }
  }

  if (!browserLaunchPromise) {
    const launchOptions = {
      headless: config.whatsappWeb.headless,
      userDataDir: config.whatsappWeb.userDataDir,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
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
      });
      return sharedBrowser;
    })();
  }

  return browserLaunchPromise;
}

// Serial task queue — prevents concurrent page operations on the same session
let taskQueue = Promise.resolve();

function enqueue(fn) {
  taskQueue = taskQueue.then(fn, fn);
  return taskQueue;
}

// Persistent QR/session page
let sessionPage = null;

async function getSessionPage() {
  const browser = await getSharedBrowser();

  if (sessionPage && !sessionPage.isClosed()) {
    return sessionPage;
  }

  sessionPage = await browser.newPage();
  await sessionPage.goto("https://web.whatsapp.com", { waitUntil: "networkidle2" });
  return sessionPage;
}

export async function getWhatsAppStatus() {
  const page = await getSessionPage();
  const loggedIn = await page.evaluate(() => {
    return Boolean(document.querySelector("div[data-testid='chat-list']") ||
      document.querySelector("div[data-testid='default-user']") ||
      document.querySelector("#side"));
  });
  return { loggedIn };
}

export async function getWhatsAppQR() {
  const page = await getSessionPage();

  // If already logged in, no QR needed
  const loggedIn = await page.evaluate(() =>
    Boolean(document.querySelector("#side"))
  );
  if (loggedIn) return { loggedIn: true, qr: null };

  // Wait for page to settle then dump all img/canvas info for debugging
  await new Promise((r) => setTimeout(r, 8000));

  const debug = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img")).map((el) => ({
      src: el.src?.slice(0, 80),
      alt: el.alt,
      dataRef: el.closest("[data-ref]") ? el.closest("[data-ref]").getAttribute("data-ref")?.slice(0, 20) : null,
      parent: el.parentElement?.className?.slice(0, 60),
    }));
    const canvases = Array.from(document.querySelectorAll("canvas")).map((el) => ({
      width: el.width,
      height: el.height,
      parent: el.parentElement?.className?.slice(0, 60),
    }));
    const svgs = Array.from(document.querySelectorAll("svg")).map((el) => ({
      parent: el.parentElement?.className?.slice(0, 60),
      dataTestid: el.closest("[data-testid]")?.getAttribute("data-testid"),
    }));
    const bodySnippet = document.body.innerHTML.slice(0, 2000);
    return { imgs, canvases, svgs, bodySnippet };
  });

  console.log("[WhatsApp QR debug]", JSON.stringify(debug, null, 2));
  throw new Error("QR_DEBUG: check server logs for element info");
}

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
  } catch (error) {
    // Dialog not present; continue normally.
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

export async function sendWhatsAppWebMessage(record) {
  if (!config.whatsappWeb.enabled) throw new Error("WhatsApp Web automation is disabled");

  const phone = record.phoneNumber || "";
  if (!phone.trim()) throw new Error("Phone number is missing");

  return enqueue(async () => {
    const message = buildReminderMessage(record);
    const url = buildWhatsAppWebUrl(phone, message);
    const browser = await getSharedBrowser();
    // Ensure session page exists (keeps session alive)
    await getSessionPage();
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle2" });
      await handleUseHereDialog(page);
      await waitForChatInput(page, config.whatsappWeb.loginTimeoutMs);
      await sendMessageOnPage(page, config.whatsappWeb.sendDelayMs);
      await waitForSendConfirmation(page, config.whatsappWeb.loginTimeoutMs);
    } finally {
      await page.close();
    }
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
