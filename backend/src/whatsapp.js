import { config } from "./config.js";

function buildCallMeBotUrl(phoneNumber, message, apiKey) {
  const normalizedPhone = phoneNumber.replace(/^whatsapp:/i, "").trim();
  const query = new URLSearchParams({
    phone: normalizedPhone,
    text: message,
    apikey: apiKey,
  });
  return `https://api.callmebot.com/whatsapp.php?${query.toString()}`;
}

export function buildReminderMessage(record) {
  const expiryText = new Date(record.expiryDate).toISOString().slice(0, 10);
  const vehicleNumber = record.vehicleNumber || record.vehicleNo || "UNKNOWN";
  return (
    `Hello ${record.name},\n` +
    `This is a reminder that the insurance for your VEHICAL NO (${vehicleNumber}) is about to expire on ${expiryText}.\n` +
    "Please renew your insurance on time."
  );
}

export async function sendWhatsAppReminder(record) {
  const apiKey = config.callmebot.apiKey;
  const phoneNumber = record.phoneNumber || "";
  if (!apiKey || !phoneNumber.trim()) {
    console.log(`[Reminder skipped] CallMeBot env not configured for ${record.phoneNumber}`);
    return { skipped: true };
  }

  const body = buildReminderMessage(record);
  const url = buildCallMeBotUrl(phoneNumber, body, apiKey);

  const response = await fetch(url);
  const responseText = await response.text();

  if (!response.ok || responseText.toLowerCase().includes("error")) {
    throw new Error(responseText || "CallMeBot request failed");
  }

  return { skipped: false, response: responseText.trim() };
}

export async function sendWhatsAppReminders(records) {
  let sentCount = 0;
  let failedCount = 0;

  for (const record of records) {
    try {
      const result = await sendWhatsAppReminder(record);
      if (result.skipped) {
        continue;
      }

      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`CallMeBot reminder failed for ${record.phoneNumber}`, error.message);
    }
  }

  return { sentCount, failedCount };
}
