import xlsx from "xlsx";
import { buildRecordKeyFromRecord } from "./recordKey.js";

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const date = xlsx.SSF.parse_date_code(value);
    if (date) {
      return new Date(date.y, date.m - 1, date.d);
    }
  }

  if (typeof value === "string") {
    const clean = value.trim();

    // Supports formats like 01-08-2026, 13/02/2026, 18/3/2026.
    const dmYMatch = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (dmYMatch) {
      const day = Number(dmYMatch[1]);
      const month = Number(dmYMatch[2]);
      const year = Number(dmYMatch[3]);
      const parsedDMY = new Date(year, month - 1, day);

      if (
        parsedDMY.getFullYear() === year &&
        parsedDMY.getMonth() === month - 1 &&
        parsedDMY.getDate() === day
      ) {
        return parsedDMY;
      }
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function getColumnValue(row, candidates) {
  const keys = Object.keys(row);
  const lowerMap = keys.reduce((acc, key) => {
    acc[normalizeHeader(key)] = key;
    return acc;
  }, {});

  for (const candidate of candidates) {
    const key = lowerMap[normalizeHeader(candidate)];
    if (key && row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }
  return null;
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  if (raw.startsWith("+")) {
    return raw;
  }

  return raw;
}

export function parseUploadedFile(filePath) {
  const workbook = xlsx.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];

  const rows = xlsx.utils.sheet_to_json(firstSheet, {
    defval: "",
    raw: false,
  });

  return rows
    .map((row, index) => {
      const name = getColumnValue(row, ["name", "client name"]);
      const phoneRaw = getColumnValue(row, [
        "phone number",
        "phone",
        "mobile",
        "mobile no",
        "mobile no.",
        "contact",
        "whatsapp",
      ]);
      const expiryRaw = getColumnValue(row, [
        "expiry date",
        "expiry",
        "expiration date",
        "validity",
        "valid till",
      ]);
      const vehicleRaw = getColumnValue(row, [
        "vehicle no",
        "vehicle number",
        "vehical no",
        "vehical number",
        "vehical no.",
        "vehicle no.",
        "veh no",
        "reg no",
        "registration",
      ]);
      const phoneNumber = normalizePhoneNumber(phoneRaw);
      const expiryDate = parseDate(expiryRaw);
      const vehicleNumber = String(vehicleRaw || "").trim();

      if (!name || !phoneNumber || !expiryDate) {
        return null;
      }

      return {
        id: `${Date.now()}-${index}`,
        name: String(name).trim(),
        phoneNumber: String(phoneNumber).trim(),
        vehicleNumber: vehicleNumber || "",
        expiryDate: expiryDate.toISOString(),
        lastReminderSentOn: null,
        recordKey: buildRecordKeyFromRecord({
          name,
          phoneNumber,
          vehicleNumber,
        }),
      };
    })
    .filter(Boolean);
}
