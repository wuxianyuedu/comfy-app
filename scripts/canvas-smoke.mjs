// Canvas interaction smoke test (Playwright, headless).
//
// What it verifies — the two things curl can't:
//   1. Right-click on the canvas opens the node-creation menu and actually
//      creates nodes (生图 / 生视频 / 生成剧本 / Agent 模式).
//   2. Dragging from a source handle to a target handle creates a real edge
//      (the wiring that powers "connect nodes to feed upstream output downstream").
//
// Usage:
//   BASE_URL=http://localhost:3000 node scripts/canvas-smoke.mjs
// (a running `next start` / `next dev` is required; see package.json `smoke:canvas`.)

import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Playwright's default headless mode wants the "chromium_headless_shell"
// build. To avoid a second ~115MB download we reuse the already-extracted
// full Chromium (chrome-win64/chrome.exe) and drive it with --headless=new.
function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const p = join(base, dir, "chrome-win64", "chrome.exe");
  return existsSync(p) ? p : undefined;
}

/** Right-click the pane at (x,y) and pick a node type from the context menu. */
async function createNode(page, x, y, label) {
  const before = await page.locator(".react-flow__node").count();
  await page.mouse.click(x, y, { button: "right" });
  // context menu header text: "创建节点"
  await page.getByText("创建节点").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: new RegExp(label) }).first().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".react-flow__node").length > n,
    before,
    { timeout: 5000 }
  );
}

async function main() {
  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    executablePath: resolveChromiumExecutable(),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${m.text()}`);
  });

  console.log(`→ navigating to ${BASE_URL}/workspace`);
  await page.goto(`${BASE_URL}/workspace`, { waitUntil: "networkidle", timeout: 30000 });

  // Enter the canvas view via the left toolbar ("画布" nav item, title attr).
  await page.getByTitle("画布").click();
  await page.waitForSelector(".react-flow", { timeout: 10000 });
  console.log("✓ canvas mounted");

  // Create two 生图 (image) nodes at empty spots on the pane.
  await createNode(page, 250, 260, "生图");
  await createNode(page, 1000, 540, "生图");

  const nodeCount = await page.locator(".react-flow__node").count();
  console.log(`✓ created ${nodeCount} node(s)`);
  if (nodeCount < 2) throw new Error(`expected ≥2 nodes, got ${nodeCount}`);

  // Let fitView settle so handle screen coords are stable.
  await page.waitForTimeout(500);

  // Drag-connect: source handle (right) of node1 → target handle (left) of node2.
  const ids = await page.$$eval(".react-flow__node", (els) =>
    els.map((e) => e.getAttribute("data-id"))
  );
  const [id1, id2] = ids;

  const src = page.locator(
    `.react-flow__node[data-id="${id1}"] .react-flow__handle.source`
  );
  const tgt = page.locator(
    `.react-flow__node[data-id="${id2}"] .react-flow__handle.target`
  );
  if ((await src.count()) === 0) throw new Error("source handle not found");
  if ((await tgt.count()) === 0) throw new Error("target handle not found");

  const sb = await src.boundingBox();
  const tb = await tgt.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 24 });
  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__edge").length >= 1,
    undefined,
    { timeout: 5000 }
  );
  const edgeCount = await page.locator(".react-flow__edge").count();
  console.log(`✓ created ${edgeCount} edge(s) via drag-connect`);

  if (errors.length) {
    console.warn("⚠ page errors/console errors captured:");
    errors.forEach((e) => console.warn("   " + e));
  }

  await browser.close();
  console.log(`\nSMOKE OK — nodes=${nodeCount}, edges=${edgeCount}`);
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err.message || err);
  process.exit(1);
});
