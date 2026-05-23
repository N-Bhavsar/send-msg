import puppeteer from "puppeteer";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

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

  const browser = await puppeteer.launch(launchOptions);

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

  const browser = await puppeteer.launch(launchOptions);

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
