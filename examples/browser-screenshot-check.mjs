import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const port = Number(process.env.IROHARNESS_E2E_PORT || 4179);
const baseUrl = process.env.IROHARNESS_E2E_URL || `http://127.0.0.1:${port}`;
const outputDir = resolve(process.env.IROHARNESS_E2E_OUTPUT_DIR || "agent-output/browser-e2e");
const timeoutMs = Number(process.env.IROHARNESS_E2E_TIMEOUT_MS || 20000);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const importPlaywright = async () => {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      [
        "Playwright is required for browser screenshot checks.",
        "Install it for this run with: npm install --no-save playwright && npx playwright install chromium",
        error.message
      ].join(" ")
    );
  }
};

const waitForHealth = async ({ url, timeout }) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}/health`);
};

const startServer = async () => {
  if (process.env.IROHARNESS_E2E_URL) {
    return null;
  }
  const child = spawn(process.execPath, ["examples/browser-server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      IROHARNESS_ADMIN_TOKEN: process.env.IROHARNESS_ADMIN_TOKEN || "e2e-admin-token"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      process.stderr.write(`browser demo server exited with code ${code} signal ${signal || ""}\n`);
    }
  });
  await waitForHealth({ url: baseUrl, timeout: timeoutMs });
  return child;
};

const stopServer = async (child) => {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGINT");
  await sleep(250);
  if (!child.killed) {
    child.kill("SIGTERM");
  }
};

const assertLocatorVisible = async (page, selector) => {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`Expected visible non-empty locator: ${selector}`);
  }
};

const screenshot = async ({ page, name }) => {
  const path = join(outputDir, `${name}.png`);
  const buffer = await page.screenshot({ path, fullPage: true });
  if (buffer.length < 2000) {
    throw new Error(`Screenshot looks too small: ${path}`);
  }
  return path;
};

const run = async () => {
  mkdirSync(outputDir, { recursive: true });
  const { chromium } = await importPlaywright();
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await assertLocatorVisible(page, "#avatar");
    await assertLocatorVisible(page, "#turn-form");
    const chatPath = await screenshot({ page, name: "chat" });

    await page.goto(`${baseUrl}/?view=overlay`, { waitUntil: "networkidle" });
    await assertLocatorVisible(page, "#avatar");
    const overlayHidden = await page.locator(".panel").evaluate((node) => {
      const style = window.getComputedStyle(node);
      return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
    });
    if (!overlayHidden) {
      throw new Error("Overlay view should hide the control panel");
    }
    const overlayPath = await screenshot({ page, name: "overlay" });

    await page.goto(`${baseUrl}/?view=admin&token=e2e-admin-token`, { waitUntil: "networkidle" });
    await assertLocatorVisible(page, "#admin-token-form");
    await assertLocatorVisible(page, "#user-form");
    await assertLocatorVisible(page, "#audience-table");
    const adminPath = await screenshot({ page, name: "admin" });

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          screenshots: [chatPath, overlayPath, adminPath]
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    await stopServer(server);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
