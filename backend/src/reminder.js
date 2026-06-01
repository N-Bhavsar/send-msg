import cron from "node-cron";
import { config } from "./config.js";
import { readStore, writeStore } from "./storage.js";
import { sendWhatsAppWebMessage } from "./whatsappWeb.js";

function daysBetween(start, end) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUtc - startUtc) / msPerDay);
}

function shouldSendReminder(record, today) {
  const expiryDate = new Date(record.expiryDate);
  if (Number.isNaN(expiryDate.getTime())) {
    return false;
  }

  const daysToExpiry = daysBetween(today, expiryDate);
  const isNearOrExpired = daysToExpiry <= config.reminderWindowDays;

  if (!isNearOrExpired) {
    return false;
  }

  const todayStamp = today.toISOString().slice(0, 10);
  return record.lastReminderSentOn !== todayStamp;
}

export function getNearExpiryRecords() {
  const store = readStore();
  const records = Array.isArray(store.records) ? store.records : [];
  const today = new Date();

  return records.filter((record) => {
    const expiryDate = new Date(record.expiryDate);
    if (Number.isNaN(expiryDate.getTime())) {
      return false;
    }

    const daysToExpiry = daysBetween(today, expiryDate);
    const isNear = daysToExpiry >= 0 && daysToExpiry <= config.reminderWindowDays;

    if (!isNear) {
      return false;
    }

    const todayStamp = today.toISOString().slice(0, 10);
    return record.lastReminderSentOn !== todayStamp;
  });
}

export async function processDailyReminders() {
  const store = readStore();
  const records = Array.isArray(store.records) ? store.records : [];
  const today = new Date();
  const todayStamp = today.toISOString().slice(0, 10);

  let sentCount = 0;
  let skippedCount = 0;
  let hasUpdates = false;

  for (const record of records) {
    if (!shouldSendReminder(record, today)) {
      continue;
    }

    try {
      const result = await sendWhatsAppWebMessage(record);
      if (result?.mode === "manual") {
        skippedCount += 1;
      } else {
        record.lastReminderSentOn = todayStamp;
        sentCount += 1;
        hasUpdates = true;
      }
    } catch (error) {
      skippedCount += 1;
      console.error(`Reminder failed for ${record.phoneNumber}`, error.message);
    }
  }

  if (hasUpdates) {
    writeStore(store);
  }

  console.log(`[Reminder job] Completed. Sent: ${sentCount}, skipped: ${skippedCount}`);

  return { sentCount, skippedCount };
}

export async function sendReminderForRecord(recordId) {
  const store = readStore();
  const record = (store.records || []).find((r) => String(r.id) === String(recordId));

  if (!record) {
    throw new Error("Record not found");
  }

  const result = await sendWhatsAppWebMessage(record);
  if (result?.mode !== "manual") {
    record.lastReminderSentOn = new Date().toISOString().slice(0, 10);
    writeStore(store);
  }

  return {
    skipped: result?.mode === "manual",
    phoneNumber: record.phoneNumber,
    name: record.name,
    ...result,
  };
}

export function startReminderScheduler() {
  cron.schedule("0 9 * * *", () => {
    processDailyReminders();
  });

  if (config.reminderRunOnStartup) {
    processDailyReminders();
  }
}
