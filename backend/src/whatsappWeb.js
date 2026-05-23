import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode";
import { config } from "./config.js";
import { buildReminderMessage } from "./whatsapp.js";

let client = null;
let clientStatus = "disconnected"; // disconnected | qr | connecting | connected
let currentQR = null;

function getClient() {
  if (client) return client;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsappWeb.userDataDir }),
    puppeteer: {
      headless: true,
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
    console.log("[WhatsApp] QR received");
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

// Start client on module load
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
  if (clientStatus !== "connected") throw new Error("WhatsApp is not connected. Please scan the QR code first.");

  const phone = String(record.phoneNumber || "").trim().replace(/\D/g, "");
  if (!phone) throw new Error("Phone number is missing");

  const chatId = `${phone}@c.us`;
  const message = buildReminderMessage(record);
  await client.sendMessage(chatId, message);
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
