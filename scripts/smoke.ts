// End-to-end smoke test for the ComfyUI txt2img pipeline and DB state.
// Run: DATABASE_URL="file:./dev.db" COMFYUI_BASE="http://localhost:8188" npx tsx scripts/smoke.ts
import { PrismaClient } from "@prisma/client";
import { buildAndValidate } from "../src/lib/comfyui/workflow";
import { postPrompt, getHistory, getView, listModels } from "../src/lib/comfyui/client";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const CKPT = "waiIllustriousSDXL_v170.safetensors";

async function main() {
  // 1) DB state
  const modelCount = await prisma.model.count({ where: { isAvailable: true } });
  const userCount = await prisma.user.count();
  console.log(`[DB] available models=${modelCount} users=${userCount}`);

  // 2) ComfyUI reachable
  const ckpts = await listModels("checkpoints");
  console.log(`[ComfyUI] checkpoints on disk=${ckpts.length}, has target=${ckpts.includes(CKPT)}`);

  // 3) Build + validate workflow
  const built = await buildAndValidate("txt2img", {
    prompt: "a cute cat sitting on a windowsill, soft light, masterpiece",
    negative: "blurry, low quality",
    checkpoint: CKPT,
    size: "768x768",
    steps: 20,
    cfg: 6,
    sampler: "euler",
    scheduler: "normal",
    count: 1,
    seed: 12345,
  });
  if (!built.ok) throw new Error(`build failed: ${built.error}`);
  console.log(`[Workflow] built graph nodes=${Object.keys(built.prompt!).length}`);

  // 4) Submit to ComfyUI
  const clientId = "smoke-test";
  const submitted = await postPrompt(built.prompt, clientId);
  const promptId = submitted.prompt_id;
  if (!promptId) throw new Error(`submit failed: ${JSON.stringify(submitted)}`);
  console.log(`[ComfyUI] prompt_id=${promptId}`);

  // 5) Poll history
  let filename: string | undefined, subfolder = "", type = "";
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const hist = (await getHistory(promptId)) as any;
    const entry = hist[promptId];
    if (entry && entry.outputs) {
      for (const node of Object.values(entry.outputs) as any[]) {
        if (node?.images?.length) {
          ({ filename, subfolder, type } = node.images[0]);
          break;
        }
      }
      if (filename) break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!filename) throw new Error("no output produced within timeout");

  // 6) Download result
  const buf = await getView(filename!, subfolder, type);
  const outPath = join(process.cwd(), "scripts", "smoke-output.png");
  writeFileSync(outPath, buf);
  console.log(`[Result] downloaded image bytes=${buf.length} -> ${outPath}`);
  console.log("SMOKE TEST PASSED");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("SMOKE TEST FAILED:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
