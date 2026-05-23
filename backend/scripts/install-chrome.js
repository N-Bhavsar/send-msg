
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// Install chrome for the top-level puppeteer
execSync("npx puppeteer browsers install chrome", { stdio: "inherit" });

// Also install for whatsapp-web.js bundled puppeteer-core
const wwjsPuppeteer = join(
  process.cwd(),
  "node_modules/whatsapp-web.js/node_modules/.bin/puppeteer"
);

if (existsSync(wwjsPuppeteer)) {
  execSync(`${wwjsPuppeteer} browsers install chrome`, { stdio: "inherit" });
} else {
  // Fallback: install into the cache path whatsapp-web.js expects
  execSync(
    "node -e \"const p = require('./node_modules/whatsapp-web.js/node_modules/puppeteer-core'); console.log(p.executablePath())\"",
    { stdio: "inherit" }
  );
}
