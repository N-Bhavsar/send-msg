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
      "exec",
      "puppeteer",
      "browsers",
      "install",
      "chrome",
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

async function launchBrowser(launchOptions) {
  try {
    return await puppeteer.launch(launchOptions);
  } catch (error) {
    if (!config.whatsappWeb.executablePath && isMissingChromeError(error)) {
      console.warn("Chrome was missing for WhatsApp Web automation. Installing Puppeteer browser and retrying once.");
      await ensureChromeBrowserInstalled();
      return puppeteer.launch(launchOptions);
    }

    throw error;
  }
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
  if (!config.whatsappWeb.enabled) {
    throw new Error("WhatsApp Web automation is disabled");
  }

  const phone = record.phoneNumber || "";
  const message = buildReminderMessage(record);
  const url = buildWhatsAppWebUrl(phone, message);

  if (!phone.trim()) {
    throw new Error("Phone number is missing");
  }

  const launchOptions = {
    headless: config.whatsappWeb.headless,
    userDataDir: config.whatsappWeb.userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  if (config.whatsappWeb.executablePath) {
    launchOptions.executablePath = config.whatsappWeb.executablePath;
  }

  const browser = await launchBrowser(launchOptions);

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

export async function sendWhatsAppWebMessages(records) {
  if (!config.whatsappWeb.enabled) {
    throw new Error("WhatsApp Web automation is disabled");
  }

  const launchOptions = {
    headless: config.whatsappWeb.headless,
    userDataDir: config.whatsappWeb.userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  if (config.whatsappWeb.executablePath) {
    launchOptions.executablePath = config.whatsappWeb.executablePath;
  }

  const browser = await launchBrowser(launchOptions);

  let sentCount = 0;
  let failedCount = 0;

  try {
    for (const record of records) {
      const phone = record.phoneNumber || "";
      const message = buildReminderMessage(record);
      const url = buildWhatsAppWebUrl(phone, message);

      if (!phone.trim()) {
        failedCount += 1;
        continue;
      }

      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle2" });
        await handleUseHereDialog(page);
        await waitForChatInput(page, config.whatsappWeb.loginTimeoutMs);
        await sendMessageOnPage(page, config.whatsappWeb.sendDelayMs);
        await waitForSendConfirmation(page, config.whatsappWeb.loginTimeoutMs);
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`WhatsApp Web send failed for ${phone}`, error.message);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { sentCount, failedCount };
}
