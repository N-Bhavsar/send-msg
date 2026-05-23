import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";

const cwd = process.cwd();

function run(cmd) {
  console.log("$", cmd);
  execSync(cmd, { stdio: "inherit" });
}

// 1. Install for top-level puppeteer
run("npx puppeteer browsers install chrome");

// 2. Install for whatsapp-web.js bundled puppeteer-core
const wwjsPuppeteerCli = resolve(
  cwd,
  "node_modules/whatsapp-web.js/node_modules/puppeteer/bin/puppeteer.js"
);
const wwjsPuppeteerBin = resolve(
  cwd,
  "node_modules/whatsapp-web.js/node_modules/.bin/puppeteer"
);

if (existsSync(wwjsPuppeteerCli)) {
  run(`node ${wwjsPuppeteerCli} browsers install chrome`);
} else if (existsSync(wwjsPuppeteerBin)) {
  run(`${wwjsPuppeteerBin} browsers install chrome`);
} else {
  // Fallback: use npx with the nested puppeteer package
  const wwjsPuppeteerPkg = resolve(
    cwd,
    "node_modules/whatsapp-web.js/node_modules/puppeteer"
  );
  if (existsSync(wwjsPuppeteerPkg)) {
    run(`node -e "require('${wwjsPuppeteerPkg}').executablePath()" || true`);
    run(`cd ${wwjsPuppeteerPkg} && npx puppeteer browsers install chrome`);
  } else {
    console.warn("whatsapp-web.js puppeteer not found, skipping its chrome install");
  }
}
