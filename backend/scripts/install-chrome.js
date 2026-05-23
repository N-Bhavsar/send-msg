import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";
const env = { ...process.env, PUPPETEER_CACHE_DIR: CACHE_DIR };

function run(cmd) {
  console.log("$", cmd);
  try {
    execSync(cmd, { stdio: "inherit", env });
  } catch (e) {
    console.warn("Command failed (non-fatal):", e.message);
  }
}

console.log("Installing Chrome into:", CACHE_DIR);

// Install via top-level puppeteer
run(`PUPPETEER_CACHE_DIR="${CACHE_DIR}" npx puppeteer browsers install chrome`);

// Also install via whatsapp-web.js nested puppeteer if it has its own CLI
const nestedCli = resolve(process.cwd(), "node_modules/whatsapp-web.js/node_modules/.bin/puppeteer");
if (existsSync(nestedCli)) {
  run(`PUPPETEER_CACHE_DIR="${CACHE_DIR}" "${nestedCli}" browsers install chrome`);
}

// Verify
try {
  const found = execSync(
    `find "${CACHE_DIR}" -type f -name "chrome" 2>/dev/null | head -3`,
    { encoding: "utf8" }
  ).trim();
  console.log("Chrome binaries found:\n", found || "NONE — install may have failed");
} catch { /* ignore */ }
