// End-to-end smoke test for USER-UPLOADED ComfyUI workflows.
//
// Simulates what the frontend does:
//   1. POST /api/workflows  with a plain ComfyUI "Export (API Format)" graph
//      (NO __PROMPT__ tokens — the typical upload case) → import as a template,
//      server auto-detects the role nodes (positive/negative/checkpoint/sampler).
//   2. POST /api/generate  using that imported workflow id + a fresh prompt,
//      checkpoint, steps, seed → buildCustomWorkflow injects params by node role.
//   3. CHAIN TEST: generate an upstream image on the local GPU, re-upload it as a
//      ComfyUI input filename (exactly what canvas importOutputAsInput does), then
//      feed that filename into an uploaded img2img workflow's LoadImage node —
//      proving "upstream image auto-feeds a downstream uploaded-workflow node".
//      Covers both the __INPUT__ token path and the auto-detected inputImageNode path.
//   4. Poll the tasks until SUCCEEDED, download the produced image from
//      /api/generated and verify it is a real PNG (runs on the local ComfyUI GPU).
//
// Usage: BASE_URL=http://localhost:3300 node scripts/custom-workflow-smoke.mjs

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CKPT = "waiIllustriousSDXL_v170.safetensors";

// A minimal but valid SDXL txt2img graph in ComfyUI API format (no tokens).
const GRAPH = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
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

// img2img workflow that uses __INPUT__ token (advanced users export with tokens).
const IMG2IMG_TOKEN = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "__PROMPT__", clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "__NEG__", clip: ["1", 1] } },
  "10": { class_type: "LoadImage", inputs: { image: "__INPUT__" } },
  "11": { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["1", 2] } },
  "5": {
    class_type: "KSampler",
    inputs: {
      seed: "__SEED__", steps: "__STEPS__", cfg: "__CFG__", sampler_name: "euler",
      scheduler: "normal", denoise: 0.6, model: ["1", 0], positive: ["2", 0],
      negative: ["3", 0], latent_image: ["11", 0],
    },
  },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "ChainImg2Img" } },
};

// img2img workflow WITHOUT tokens — relies on auto-detected inputImageNode (LoadImage).
const IMG2IMG_PLAIN = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "(positive)", clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "(negative)", clip: ["1", 1] } },
  "10": { class_type: "LoadImage", inputs: { image: "" } },
  "11": { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["1", 2] } },
  "5": {
    class_type: "KSampler",
    inputs: {
      seed: 0, steps: 18, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.6,
      model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["11", 0],
    },
  },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "ChainImg2ImgPlain" } },
};

function assert(cond, msg) {
  if (!cond) {
    console.error("✗ FAIL: " + msg);
    process.exit(1);
  }
  console.log("✓ " + msg);
}

async function pollTask(taskId, label) {
  const deadline = Date.now() + 180_000;
  let task = null;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/tasks/${taskId}`);
    const payload = await r.json();
    task = payload.task || payload; // GET /api/tasks/[id] wraps as { task }
    process.stdout.write(`   ${label} status=${task.status} progress=${task.progress ?? 0}\r`);
    if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "ERROR") break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  console.log("");
  return task;
}

async function verifyImage(localPath, label) {
  const fr = await fetch(`${BASE}${localPath}`);
  const buf = Buffer.from(await fr.arrayBuffer());
  console.log(`   ${label} ${localPath}  HTTP ${fr.status}  type=${fr.headers.get("content-type")}  bytes=${buf.length}`);
  assert(fr.ok && buf.length > 1000, `${label}: served image is present and non-trivial`);
  assert(buf[0] === 0x89 && buf[1] === 0x50, `${label}: served file is a valid PNG`);
}

async function genUpstream() {
  console.log("\n== UPSTREAM: generate a base image on the local GPU ==");
  const g = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow: "txt2img",
      prompt: "a solid crimson circle on a white background, simple",
      checkpoint: CKPT,
      steps: 12,
      cfg: 7,
      seed: 123,
      size: "512x512",
    }),
  });
  const gb = await g.json();
  assert(g.status === 200 && gb.taskId, "upstream generate accepted");
  const task = await pollTask(gb.taskId, "upstream");
  assert(task.status === "SUCCEEDED", `upstream task SUCCEEDED (status=${task.status})`);
  const imgs = task.resultImages || task.images || [];
  assert(imgs.length >= 1, "upstream produced an image");
  await verifyImage(imgs[0].localPath, "upstream");
  return imgs[0].localPath;
}

// Exactly what canvas-helpers.importOutputAsInput does: fetch the already-served
// output, then re-upload it into ComfyUI's input dir to obtain a usable filename.
async function importOutputAsInputSim(localPath) {
  const abs = localPath.startsWith("/") ? localPath : `/${localPath}`;
  const r = await fetch(`${BASE}${abs}`);
  if (!r.ok) throw new Error("read upstream output failed " + r.status);
  const blob = await r.blob();
  const fname = localPath.split("/").pop() || "up.png";
  const fd = new FormData();
  fd.append("image", new File([blob], fname, { type: blob.type || "image/png" }));
  const up = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  const d = await up.json();
  if (!d.name) throw new Error("re-upload failed " + JSON.stringify(d));
  return d.name;
}

async function runChain(graph, label, wfName, upstreamPath) {
  console.log(`\n== CHAIN ${label}: upload img2img workflow + feed upstream image ==`);
  const up = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: wfName, graph }),
  });
  const upBody = await up.json();
  assert(up.status === 200, `${label}: import returned 200`);
  const wfId = upBody.id;
  const pm = upBody.paramMap || {};
  console.log("   detected paramMap:", JSON.stringify(pm));
  assert(pm.inputImageNode === "10", `${label}: LoadImage(inputImageNode) auto-detected = node 10`);

  const inputName = await importOutputAsInputSim(upstreamPath);
  console.log("   upstream re-uploaded as ComfyUI input filename:", inputName);

  const gen = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow: wfId,
      prompt: "the crimson circle reimagined as a glowing blue star, soft light",
      negative: "blurry, low quality, watermark",
      checkpoint: CKPT,
      steps: 18,
      cfg: 7,
      seed: 555,
      inputImage: inputName, // ← the fed upstream image
    }),
  });
  const genBody = await gen.json();
  assert(gen.status === 200 && genBody.taskId, `${label}: generate with fed input accepted`);
  const task = await pollTask(genBody.taskId, label);
  assert(task.status === "SUCCEEDED", `${label}: task SUCCEEDED (status=${task.status})`);
  const imgs = task.resultImages || task.images || [];
  assert(imgs.length >= 1, `${label}: produced an image`);
  for (const im of imgs) await verifyImage(im.localPath, label);
  return wfId;
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

  const pm = upBody.paramMap || {};
  console.log("   detected paramMap:", JSON.stringify(pm));
  assert(pm.positiveNode === "2", "positive prompt node auto-detected = node 2");
  assert(pm.negativeNode === "3", "negative prompt node auto-detected = node 3");
  assert(pm.checkpointNode === "1", "checkpoint node auto-detected = node 1");
  assert(pm.samplerNode === "5", "sampler node auto-detected = node 5");

  console.log("\n== STEP 2: generate using the UPLOADED workflow ==");
  const gen = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow: wfId,
      prompt: "a cute orange cat sitting on a windowsill, soft sunlight, masterpiece",
      negative: "blurry, low quality, watermark",
      checkpoint: CKPT,
      steps: 18,
      cfg: 7,
      seed: 777,
      size: "768x768",
    }),
  });
  const genBody = await gen.json();
  assert(gen.status === 200 && genBody.taskId, "generate accepted the uploaded workflow");
  const task = await pollTask(genBody.taskId, "base");
  assert(task.status === "SUCCEEDED", `task finished with status=${task.status}`);
  const imgs = task.resultImages || task.images || [];
  assert(imgs.length >= 1, "task produced at least one image");
  for (const im of imgs) await verifyImage(im.localPath, "base");
  const baseWfId = wfId;

  // ── CHAIN TEST: feed an upstream image into uploaded img2img workflows ──
  const upstreamPath = await genUpstream();
  const chainIds = [];
  chainIds.push(await runChain(IMG2IMG_TOKEN, "A(token)", "串联测试-token式img2img", upstreamPath));
  chainIds.push(await runChain(IMG2IMG_PLAIN, "B(plain)", "串联测试-无token式img2img", upstreamPath));

  console.log("\n== STEP 4: cleanup (delete all uploaded workflows) ==");
  for (const id of [baseWfId, ...chainIds]) {
    const del = await fetch(`${BASE}/api/workflows/${id}`, { method: "DELETE" });
    assert(del.status === 200, `deleted workflow ${id} (HTTP ${del.status})`);
    const after = await fetch(`${BASE}/api/workflows/${id}`);
    assert(after.status === 404, `deleted workflow ${id} no longer fetchable`);
  }

  console.log("\n✅ CUSTOM-WORKFLOW SMOKE PASSED (incl. upstream→workflow chaining)");
}

main().catch((e) => {
  console.error("✗ ERROR:", e.message);
  process.exit(1);
});
