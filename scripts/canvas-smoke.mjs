// Canvas interaction smoke test (Playwright, headless).
//
// What it verifies — the two things curl can't:
//   1. Right-click on the canvas opens the node-creation menu and actually
//      creates nodes (生图 / 生视频 / 生成剧本 / Agent 模式 / 自定义工作流).
//   2. Dragging from a source handle to a target handle creates a real edge
//      (the wiring that powers "connect nodes to feed upstream output downstream").
//
// Usage:
//   BASE_URL=http://localhost:3500 node scripts/canvas-smoke.mjs
// (a running `next start` / `next dev` is required; see package.json `smoke:canvas`.)
//
// Notes on the sandbox:
//   - We navigate to `/workspace?tab=canvas` because the left nav (and thus the
//     ReactFlow canvas) only renders in non-"home" view modes.
//   - Chromium is pointed at the already-extracted full build via executablePath
//     (no second headless-shell download needed). If PLAYWRIGHT_BROWSERS_PATH is
//     unset, it falls back to Playwright's default (which needs the shell build).
//   - `--no-proxy-server` forces direct connections so the sandbox egress proxy
//     (which otherwise routes stray requests to copilot.tencent.com and fails DNS)
//     never interferes with hitting localhost.

import { chromium } from "playwright";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SMOKE_DIR = join(process.cwd(), ".local-tmp");
let activePage = null;

// Reuse the already-extracted full Chromium (chrome-win64/chrome.exe).
function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const p = join(base, dir, "chrome-win64", "chrome.exe");
  return existsSync(p) ? p : undefined;
}

/** Right-click the pane at (x,y) and pick a node type from the context menu. */
async function createNode(page, x, y, kind) {
  const before = await page.locator(".react-flow__node").count();
  await page.mouse.click(x, y, { button: "right" });
  // context menu header text: "创建节点" (exact — the empty-canvas hint also
  // contains that substring, so avoid a strict-mode match violation).
  await page.getByText("创建节点", { exact: true }).waitFor({ timeout: 5000 });
  // The menu button carries data-canvas-node-kind so we don't accidentally
  // match the in-node "文生图" mode toggle (same /生图/ substring).
  await page.locator(`[data-canvas-node-kind="${kind}"]`).first().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".react-flow__node").length > n,
    before,
    { timeout: 5000 }
  );
}

async function main() {
  mkdirSync(SMOKE_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--no-proxy-server", // hit localhost directly; avoid sandbox proxy DNS failures
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--disable-extensions",
    ],
    executablePath: resolveChromiumExecutable(),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  activePage = page;

  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${m.text()}`);
  });

  // Enter the canvas view directly via ?tab=canvas (skips the home screen,
  // which does not render the left nav / ReactFlow).
  console.log(`→ navigating to ${BASE_URL}/workspace?tab=canvas`);
  await page.goto(`${BASE_URL}/workspace?tab=canvas`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForSelector(".react-flow", { timeout: 15000 });
  console.log("✓ canvas mounted");

  // Create two 生图 (image) nodes at empty spots on the pane.
  await createNode(page, 250, 260, "image");
  await createNode(page, 1000, 540, "image");

  const nodeCount = await page.locator(".react-flow__node").count();
  console.log(`✓ created ${nodeCount} node(s)`);
  if (nodeCount < 2) throw new Error(`expected ≥2 nodes, got ${nodeCount}`);

  // Let fitView settle so handle screen coords are stable.
  await page.waitForTimeout(700);

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
  if (!sb || !tb) throw new Error("handle boundingBox unavailable");
  // Use Playwright's built-in dragTo() which emits the full pointer-event chain
  // (pointerdown → pointermove* → pointerup) that ReactFlow's Handle expects.
  await src.dragTo(tgt);

  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__edge").length >= 1,
    undefined,
    { timeout: 6000 }
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

main().catch(async (err) => {
  console.error("\nSMOKE FAILED:", err.message || err);
  // Best-effort diagnostic screenshot (gitignored).
  try {
    const p = join(SMOKE_DIR, "canvas-smoke-fail.png");
    if (activePage) await activePage.screenshot({ path: p, fullPage: true });
    console.error(`(diagnostic screenshot → ${p})`);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
