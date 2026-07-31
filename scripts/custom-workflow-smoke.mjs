// End-to-end smoke test for USER-UPLOADED ComfyUI workflows.
//
// Simulates what the frontend does:
//   1. POST /api/workflows  with a plain ComfyUI "Export (API Format)" graph
//      (NO __PROMPT__ tokens — the typical upload case) → import as a template,
//      server auto-detects the role nodes (positive/negative/checkpoint/sampler).
//   2. POST /api/generate  using that imported workflow id + a fresh prompt,
//      checkpoint, steps, seed → buildCustomWorkflow injects params by node role.
//   3. Poll the task until SUCCEEDED, then download the produced image from
//      /api/generated and verify it is a real PNG (runs on the local ComfyUI GPU).
//
// Usage: BASE_URL=http://localhost:3200 node scripts/custom-workflow-smoke.mjs

const BASE = process.env.BASE_URL || "http://localhost:3000";

// A minimal but valid SDXL txt2img graph in ComfyUI API format (no tokens).
const GRAPH = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "waiIllustriousSDXL_v170.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "(default positive)", clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "(default negative)", clip: ["1", 1] } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 768, height: 768, batch_size: 1 } },
  "5": {
    class_type: "KSampler",
    inputs: {
      seed: 0, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
    },
  },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "CustomUpload" } },
};

function assert(cond, msg) {
  if (!cond) {
    console.error("✗ FAIL: " + msg);
    process.exit(1);
  }
  console.log("✓ " + msg);
}

async function main() {
  console.log("== STEP 1: upload (import) a ComfyUI workflow ==");
  const up = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "端到端测试-上传工作流", graph: GRAPH }),
  });
  const upBody = await up.json();
  console.log("   POST /api/workflows -> HTTP", up.status, upBody);
  assert(up.status === 200, "workflow import returned 200");
  assert(!!upBody.id, "imported workflow has an id");
  const wfId = upBody.id;

  // Verify auto role-node detection (the whole point of uploading a plain graph).
  const pm = upBody.paramMap || {};
  console.log("   detected paramMap:", JSON.stringify(pm));
  assert(pm.positiveNode === "2", "positive prompt node auto-detected = node 2 (first CLIPTextEncode)");
  assert(pm.negativeNode === "3", "negative prompt node auto-detected = node 3 (second CLIPTextEncode)");
  assert(pm.checkpointNode === "1", "checkpoint node auto-detected = node 1");
  assert(pm.samplerNode === "5", "sampler node auto-detected = node 5 (KSampler)");

  console.log("\n== STEP 2: generate using the UPLOADED workflow ==");
  const gen = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow: wfId,
      prompt: "a cute orange cat sitting on a windowsill, soft sunlight, masterpiece",
      negative: "blurry, low quality, watermark",
      checkpoint: "waiIllustriousSDXL_v170.safetensors",
      steps: 18,
      cfg: 7,
      seed: 777,
      size: "768x768",
    }),
  });
  const genBody = await gen.json();
  console.log("   POST /api/generate -> HTTP", gen.status, genBody);
  assert(gen.status === 200, "generate accepted the uploaded workflow");
  assert(!!genBody.taskId, "generate returned a taskId");
  const taskId = genBody.taskId;

  console.log("\n== STEP 3: poll until finished ==");
  let task = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/tasks/${taskId}`);
    const payload = await r.json();
    task = payload.task || payload; // GET /api/tasks/[id] wraps as { task }
    const s = task.status;
    process.stdout.write(`   status=${s} progress=${task.progress ?? 0}\r`);
    if (s === "SUCCEEDED" || s === "FAILED" || s === "ERROR") break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  console.log("");
  assert(task && task.status === "SUCCEEDED", `task finished with status=${task?.status}`);

  const imgs = task.resultImages || task.images || [];
  console.log("   result items:", imgs.length);
  assert(imgs.length >= 1, "task produced at least one image");
  for (const im of imgs) {
    const fr = await fetch(`${BASE}${im.localPath}`);
    const buf = Buffer.from(await fr.arrayBuffer());
    console.log(`   ${im.localPath}  HTTP ${fr.status}  type=${fr.headers.get("content-type")}  bytes=${buf.length}`);
    assert(fr.ok && buf.length > 1000, "served image is present and non-trivial");
    assert(buf[0] === 0x89 && buf[1] === 0x50, "served file is a valid PNG");
  }

  console.log("\n== STEP 4: cleanup (delete the uploaded workflow) ==");
  const del = await fetch(`${BASE}/api/workflows/${wfId}`, { method: "DELETE" });
  console.log("   DELETE /api/workflows/:id -> HTTP", del.status);
  assert(del.status === 200, "uploaded workflow deleted");
  // confirm gone
  const after = await fetch(`${BASE}/api/workflows/${wfId}`);
  assert(after.status === 404, "deleted workflow is no longer fetchable");

  console.log("\n✅ CUSTOM-WORKFLOW SMOKE PASSED");
}

main().catch((e) => {
  console.error("✗ ERROR:", e.message);
  process.exit(1);
});
