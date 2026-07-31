// Real end-to-end generation smoke test.
// Submits a txt2img job through the app's own /api/generate (which forwards to
// the user's local ComfyUI on :8188, runs GPU sampling, downloads + stores the
// result), then polls /api/tasks/:id until SUCCEEDED and verifies the served file.
//
// Usage:  BASE_URL=http://localhost:3000 node scripts/gen-smoke.mjs

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CKPT = "waiIllustriousSDXL_v170.safetensors";
const PROMPT = "a cute orange cat sitting on a sunny windowsill, soft morning light, anime illustration, masterpiece, high quality";
const NEGATIVE = "lowres, bad anatomy, worst quality, blurry";

async function main() {
  console.log("==> POST /api/generate (txt2img via ComfyUI :8188)");
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow: "txt2img",
      prompt: PROMPT,
      negative: NEGATIVE,
      checkpoint: CKPT,
      steps: 18,
      cfg: 6,
      size: "768x768",
      seed: 12345,
      count: 1,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("SUBMIT FAILED", res.status, data);
    process.exit(1);
  }
  const taskId = data.taskId;
  console.log("    taskId =", taskId, "(submit HTTP", res.status + ")");

  const deadline = Date.now() + 4 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/tasks/${taskId}`);
    const j = await r.json().catch(() => ({}));
    const t = j.task;
    const st = t?.status;
    if (st !== lastStatus) {
      console.log(`    status -> ${st}  progress=${t?.progress ?? 0}`);
      lastStatus = st;
    }
    if (st === "SUCCEEDED" || st === "FAILED" || st === "CANCELLED") {
      if (st === "SUCCEEDED") {
        const imgs = t.resultImages || t.images || [];
        console.log("==> RESULT (" + imgs.length + " item(s)):");
        let allOk = true;
        for (const im of imgs) {
          const fr = await fetch(`${BASE}${im.localPath}`);
          const buf = await fr.arrayBuffer();
          const len = buf.byteLength;
          console.log(
            `    ${im.localPath}  HTTP ${fr.status}  type=${fr.headers.get("content-type")}  bytes=${len}`
          );
          if (!fr.ok || len < 100) {
            console.error("    !! served file missing or too small");
            allOk = false;
          }
        }
        if (!allOk) process.exit(2);
        console.log("==> PASS: real image generated through ComfyUI + GPU.");
        process.exit(0);
      } else {
        console.error("==> FAIL: task ended as", st, "—", t?.error || "");
        process.exit(2);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error("==> TIMEOUT after 4m");
  process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
