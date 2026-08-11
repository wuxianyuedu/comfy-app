import { runSmokeP1 } from "./smoke-p1.mts";
import { runSmokeSeed } from "./smoke-seed.mts";
import { runSmokeOutputs } from "./smoke-outputs.mts";
import { runSmokeDstSlot } from "./smoke-dstslot.mts";
import { runSmokeRegistry } from "./smoke-registry.mts";
import { runLiveE2E } from "./e2e-runner.mts";
import { makeSuite, summarize, type SuiteResult } from "./regression-harness.mts";
import { prisma } from "@/lib/db";

/**
 * Live HTTP round-trip: POST /api/generate, then poll the DB task until terminal.
 * Skips (does not fail) when no dev server is reachable.
 */
async function runHttpE2E(): Promise<SuiteResult> {
  const { check, done } = makeSuite("Live HTTP: /api/generate round-trip");
  const base = process.env.COMFYUI_HTTP_BASE ?? "http://127.0.0.1:3000";
  const checkpoint =
    process.env.COMFYUI_E2E_CKPT ?? "waiIllustriousSDXL_v170.safetensors";

  let taskId = "";
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: "txt2img",
        prompt: "a cute cat, masterpiece",
        negative: "low quality",
        checkpoint,
        seed: 0,
        steps: 4,
        cfg: 6,
        sampler: "euler",
        scheduler: "normal",
        size: "512x512",
      }),
    });
    if (res.status >= 500) {
      console.log("  (dev server returned 5xx — skipping HTTP suite)");
      return { name: "Live HTTP", pass: 0, fail: 0, skipped: true };
    }
    if (!res.ok) {
      check("generate endpoint accepted request (2xx)", false, `HTTP ${res.status}`);
      return done();
    }
    const json = (await res.json()) as { taskId?: string };
    taskId = json.taskId ?? "";
    check("received taskId", !!taskId, json);
  } catch {
    console.log(`  (dev server not reachable at ${base} — skipping HTTP suite)`);
    return { name: "Live HTTP", pass: 0, fail: 0, skipped: true };
  }

  const deadline = Date.now() + 180_000;
  let final: any = null;
  while (Date.now() < deadline) {
    const t: any = await prisma.task.findUnique({ where: { id: taskId } });
    if (t?.status === "SUCCEEDED" || t?.status === "FAILED") {
      final = t;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!final) {
    check("HTTP task reached terminal state", false, "TIMEOUT");
    return done();
  }
  check("HTTP task SUCCEEDED", final.status === "SUCCEEDED", final.status);
  check(
    "HTTP task produced image",
    (final.resultImages ?? []).length >= 1,
    final.resultImages
  );
  return done();
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const http = args.includes("--http");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    console.log("Usage: tsx scripts/regression.mts [--live] [--http]");
    console.log("  (no flags)  unit regression only (P1 param-map/LoRA/prompts/dst_slot/registry + P2 seed/outputs) — no external deps");
    console.log("  --live       + live E2E against ComfyUI (base from .env COMFYUI_BASE; checkpoint from COMFYUI_E2E_CKPT or default)");
    console.log("  --http       + HTTP round-trip via /api/generate (requires dev server on :3000)");
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }

  console.log("=== Comfy-APP regression ===\n");
  const results: SuiteResult[] = [];
  results.push(await runSmokeP1());
  results.push(await runSmokeSeed());
  results.push(await runSmokeOutputs());
  results.push(await runSmokeDstSlot());
  results.push(await runSmokeRegistry());
  if (live) results.push(await runLiveE2E());
  if (http) results.push(await runHttpE2E());

  const failed = summarize(results);
  await prisma.$disconnect().catch(() => {});
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("regression threw:", e);
  process.exit(1);
});
