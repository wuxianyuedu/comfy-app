// Verify the runner captures + persists execution logs for a real generation.
// Run: DATABASE_URL="file:./dev.db" COMFYUI_BASE="http://localhost:8188" npx tsx scripts/smoke-logs.ts
import { PrismaClient } from "@prisma/client";
import { buildAndValidate } from "../src/lib/comfyui/workflow";
import { enqueue, subscribe } from "../src/lib/comfyui/runner";

const prisma = new PrismaClient();
const CKPT = "waiIllustriousSDXL_v170.safetensors";

async function main() {
  const built = await buildAndValidate("txt2img", {
    prompt: "a red apple on a wooden table, studio light",
    checkpoint: CKPT,
    size: "512x512",
    steps: 15,
    cfg: 6,
    seed: 999,
  });
  if (!built.ok) throw new Error(built.error!);

  const user = await prisma.user.upsert({
    where: { email: "demo@comfy.app" },
    update: {},
    create: {
      email: "demo@comfy.app",
      name: "体验用户",
      passwordHash: "x",
    },
  });

  const task = await prisma.task.create({
    data: {
      userId: user.id,
      type: "TXT2IMG",
      prompt: "a red apple on a wooden table, studio light",
      params: { checkpoint: CKPT } as object,
      workflowName: "txt2img",
      status: "QUEUED",
    },
  });
  console.log(`[setup] task=${task.id}`);

  const live: any[] = [];
  const unsub = subscribe(task.id, (e: any) => {
    if (e.type === "log") live.push(e.entry);
    if (e.type === "done") console.log("[done] images=", (e.images as any[]).length);
    if (e.type === "error") console.log("[error]", e.error);
  });

  enqueue({ taskId: task.id, prompt: built.prompt! });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const t = await prisma.task.findUnique({ where: { id: task.id } });
    if (t && (t.status === "SUCCEEDED" || t.status === "FAILED")) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  unsub();

  const finalTask = await prisma.task.findUnique({ where: { id: task.id } });
  const persisted = (finalTask?.logs as any[]) ?? [];
  console.log(`[status] ${finalTask?.status}`);
  console.log(`[live logs] ${live.length}  [persisted logs] ${persisted.length}`);
  console.log(persisted.map((l) => `  [${l.level}] ${l.msg}`).join("\n"));

  if (finalTask?.status !== "SUCCEEDED") throw new Error("task did not succeed");
  if (persisted.length < 3) throw new Error("too few log entries persisted");
  console.log("SMOKE LOGS PASSED");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("SMOKE LOGS FAILED:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
