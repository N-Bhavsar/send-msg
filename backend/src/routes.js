import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { login, requireAuth } from "./auth.js";
import { parseUploadedFile } from "./excel.js";
import { getNearExpiryRecords, processDailyReminders, sendReminderForRecord } from "./reminder.js";
import { buildRecordKeyFromRecord } from "./recordKey.js";
import { readStore, writeStore } from "./storage.js";
import { getWhatsAppQR, getWhatsAppStatus, sendWhatsAppWebMessages } from "./whatsappWeb.js";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  fileFilter: (_req, file, cb) => {
    const valid = /\.(xlsx|csv)$/i.test(file.originalname);
    if (!valid) {
      return cb(new Error("Only .xlsx and .csv files are allowed"));
    }
    return cb(null, true);
  },
});

export function buildRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/login", login);

  router.get("/records", requireAuth, (_req, res) => {
    const store = readStore();
    res.json(store.records || []);
  });

  router.delete("/records/:recordId", requireAuth, (req, res) => {
    const store = readStore();
    const records = Array.isArray(store.records) ? store.records : [];
    const recordId = String(req.params.recordId || "");

    const index = records.findIndex((record) => String(record.id) === recordId);
    if (index === -1) {
      return res.status(404).json({ message: "Record not found" });
    }

    const [removed] = records.splice(index, 1);
    const deletedKeys = new Set(Array.isArray(store.deletedKeys) ? store.deletedKeys : []);
    const removedKey = removed?.recordKey || buildRecordKeyFromRecord(removed);
    if (removedKey) {
      deletedKeys.add(removedKey);
    }

    store.records = records;
    store.deletedKeys = Array.from(deletedKeys);
    writeStore(store);

    return res.json({ message: "Record deleted" });
  });

  router.post("/upload", requireAuth, upload.single("file"), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const parsedRows = parseUploadedFile(req.file.path);
      const store = readStore();
      const deletedKeys = new Set(Array.isArray(store.deletedKeys) ? store.deletedKeys : []);
      const existingRecords = Array.isArray(store.records) ? store.records : [];
      const recordMap = new Map();

      for (const record of existingRecords) {
        const key = record.recordKey || buildRecordKeyFromRecord(record);
        if (!key || deletedKeys.has(key)) {
          continue;
        }
        recordMap.set(key, { ...record, recordKey: key });
      }

      let addedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const row of parsedRows) {
        const key = row.recordKey || buildRecordKeyFromRecord(row);
        if (!key || deletedKeys.has(key)) {
          skippedCount += 1;
          continue;
        }

        const existing = recordMap.get(key);
        if (existing) {
          recordMap.set(key, {
            ...existing,
            name: row.name,
            phoneNumber: row.phoneNumber,
            vehicleNumber: row.vehicleNumber,
            expiryDate: row.expiryDate,
            recordKey: key,
          });
          updatedCount += 1;
        } else {
          recordMap.set(key, { ...row, recordKey: key });
          addedCount += 1;
        }
      }

      store.records = Array.from(recordMap.values());
      store.deletedKeys = Array.from(deletedKeys);
      writeStore(store);

      fs.unlink(req.file.path, () => {});

      return res.json({
        message: "File uploaded successfully",
        count: store.records.length,
        addedCount,
        updatedCount,
        skippedCount,
      });
    } catch (error) {
      return res.status(400).json({ message: error.message || "Upload failed" });
    }
  });

  router.post("/reminders/run", requireAuth, async (_req, res) => {
    try {
      const result = await processDailyReminders();
      return res.json({
        message: "Reminder check completed",
        ...result,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Reminder run failed" });
    }
  });

  router.post("/reminders/:recordId/send", requireAuth, async (req, res) => {
    try {
      const result = await sendReminderForRecord(req.params.recordId);
      return res.json({
        message: `Reminder sent to ${result.name}`,
        ...result,
      });
    } catch (error) {
      const status = error.message === "Record not found" ? 404 : 500;
      return res.status(status).json({ message: error.message || "Send reminder failed" });
    }
  });

  router.post("/whatsapp-web/send", requireAuth, upload.single("file"), async (req, res) => {
    try {
      let records = [];

      if (req.file) {
        records = parseUploadedFile(req.file.path);
        fs.unlink(req.file.path, () => {});
      } else {
        const store = readStore();
        records = store.records || [];
      }

      if (!records.length) {
        return res.status(400).json({ message: "No records found to send." });
      }

      const result = await sendWhatsAppWebMessages(records);
      if (result?.mode === "manual") {
        return res.json({
          message: "Open each WhatsApp Web tab and click send.",
          ...result,
        });
      }

      return res.json({
        message: "WhatsApp Web send complete",
        ...result,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "WhatsApp Web send failed" });
    }
  });

  router.get("/whatsapp-web/status", requireAuth, async (_req, res) => {
    try {
      const status = await getWhatsAppStatus();
      return res.json(status);
    } catch (error) {
      return res.status(500).json({ message: error.message || "WhatsApp status failed" });
    }
  });

  router.get("/whatsapp-web/qr", requireAuth, async (_req, res) => {
    try {
      const qr = await getWhatsAppQR();
      return res.json(qr);
    } catch (error) {
      return res.status(500).json({ message: error.message || "WhatsApp QR failed" });
    }
  });

  router.post("/whatsapp-web/send-near-expiry", requireAuth, async (_req, res) => {
    try {
      const records = getNearExpiryRecords();

      if (!records.length) {
        return res.status(400).json({ message: "No near-expiry records found." });
      }

      const result = await sendWhatsAppWebMessages(records);
      if (result?.mode === "manual") {
        return res.json({
          message: "Open each WhatsApp Web tab and click send.",
          ...result,
        });
      }

      return res.json({
        message: "WhatsApp Web send complete",
        ...result,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "WhatsApp Web send failed" });
    }
  });

  return router;
}
