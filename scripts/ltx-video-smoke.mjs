// LTX-2.3 video workflow smoke test — validates the new ltxt2video graph
// against the live ComfyUI instance and confirms a real video comes back
// (mirroring exactly what the runner's `outputs[node].videos` extraction does).
//
//   node scripts/ltx-video-smoke.mjs
//
// Uses COMFYUI_BASE (default http://localhost:8188). Polls history until a
// `videos` entry appears, then downloads it to .local-tmp and checks size.

import { promises as fs } from "fs";
import path from "path";

const BASE = process.env.COMFYUI_BASE || "http://localhost:8188";
const CLIENT = "comfy-app-ltx-smoke";
const PROMPT = "A calm ocean wave rolling onto a sandy beach at golden hour, cinematic, smooth motion";
const MODEL = "LTX-2 (Fast)";
const DURATION = 6;
const RES = "1920x1080";
const FPS = 25;
const PREFIX = "ComfyAPP_ltx_smoke";

function log(m) { console.log(`[ltx-smoke] ${m}`); }

function buildGraph() {
  return {
    "1": {
      class_type: "LtxvApiTextToVideo",
      inputs: { model: MODEL, prompt: PROMPT, duration: DURATION, resolution: RES, fps: FPS, generate_audio: false },
    },
    "2": {
      class_type: "SaveVideo",
      inputs: { video: ["1", 0], filename_prefix: PREFIX, format: "mp4", codec: "h264" },
    },
  };
}

async function postPrompt(graph) {
  const r = await fetch(`${BASE}/api/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: CLIENT }),
  });
  return r.json();
}

async function getHistory(id) {
  const r = await fetch(`${BASE}/api/history/${id}`);
  return r.json();
}

async function getView(filename, subfolder, type) {
  const u = new URL(`${BASE}/api/view`);
  u.searchParams.set("filename", filename);
  u.searchParams.set("subfolder", subfolder ?? "");
  u.searchParams.set("type", type ?? "");
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`getView ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  log(`target ${BASE} · model=${MODEL} · ${DURATION}s @ ${RES} ${FPS}fps`);
  const res = await postPrompt(buildGraph());
  if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
    console.error("SUBMIT_FAIL", JSON.stringify(res.error || res.node_errors));
    process.exit(1);
  }
  const pid = res.prompt_id;
  log(`submitted prompt_id=${pid}`);

  const deadline = Date.now() + 15 * 60 * 1000;
  let lastPct = -1;
  while (Date.now() < deadline) {
    const hist = await getHistory(pid);
    const entry = hist?.[pid];
    if (entry) {
      const msgs = entry.status?.messages ?? [];
      const errored = msgs.some((m) => m?.[0] === "execution_error");
      if (errored || entry.status?.status_str === "error") {
        const ex = msgs.find((m) => m?.[0] === "execution_error")?.[1]?.exception_message;
        console.error("EXEC_FAIL", ex ?? "unknown");
        process.exit(1);
      }
      const outputs = entry.outputs ?? {};
      let videos = [];
      for (const o of Object.values(outputs)) {
        if (Array.isArray(o?.videos)) videos.push(...o.videos);
      }
      if (videos.length) {
        const v = videos[0];
        log(`video produced: ${v.filename}`);
        const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");
        const outDir = path.join(process.cwd(), ".local-tmp");
        await fs.mkdir(outDir, { recursive: true });
        const outPath = path.join(outDir, v.filename);
        await fs.writeFile(outPath, buf);
        if (buf.length < 1024) {
          console.error("VIDEO_TOO_SMALL", buf.length);
          process.exit(1);
        }
        log(`downloaded ${buf.length} bytes -> ${outPath}`);
        console.log("SMOKE_EXIT:0");
        process.exit(0);
      }
      // progress hint (best-effort)
      const prog = msgs.find((m) => m?.[0] === "progress")?.[1];
      if (prog && typeof prog.value === "number") {
        const pct = Math.round((prog.value / (prog.max || 1)) * 100);
        if (pct - lastPct >= 10) { lastPct = pct; log(`progress ${pct}%`); }
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error("TIMEOUT_NO_VIDEO");
  process.exit(1);
}

main().catch((e) => { console.error("SMOKE_ERR", e?.message); process.exit(1); });
