import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORE_PATH = path.join(__dirname, "..", "data", "store.json");

function ensureStoreExists() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ records: [], deletedKeys: [] }, null, 2)
    );
  }
}

export function readStore() {
  ensureStoreExists();
  const raw = fs.readFileSync(STORE_PATH, "utf-8");
  try {
    const data = JSON.parse(raw);
    return {
      records: Array.isArray(data.records) ? data.records : [],
      deletedKeys: Array.isArray(data.deletedKeys) ? data.deletedKeys : [],
    };
  } catch {
    return { records: [], deletedKeys: [] };
  }
}

export function writeStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}
