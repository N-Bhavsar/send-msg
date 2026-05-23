function normalizeKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function buildRecordKeyFromRecord(record) {
  const phoneDigits = String(record?.phoneNumber || "").replace(/\D/g, "");
  const vehicle = normalizeKeyPart(record?.vehicleNumber || "");

  if (!phoneDigits) {
    return "";
  }

  return `${phoneDigits}::${vehicle}`;
}
