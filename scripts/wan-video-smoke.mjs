// Local WAN image-to-video smoke test (no cloud, no authorization).
//
// Fully self-contained: it generates a tiny PNG, uploads it to the local
// ComfyUI input dir, submits the verified KJ WanVideoWrapper I2V chain, polls
// until done, then downloads the emitted video (VHS outputs under `gifs`) and
// asserts it is a non-trivial file.
//
// Before submitting it validates the three model names against ComfyUI's
// /api/object_info so a missing/unexpected filename can't silently break the
// run — and it prints the names actually used so the app's _meta.ts defaults
// can be cross-checked.
//
//   node scripts/wan-video-smoke.mjs
//
// Prints WAN_VIDEO_SMOKE_EXIT:0 on success, WAN_VIDEO_SMOKE_EXIT:1 on failure.

import zlib from "node:zlib";

const BASE = process.env.COMFYUI_BASE || "http://127.0.0.1:8188";
const CLIENT_ID = "wan-video-smoke";

// Preferred model names — mirror src/lib/comfyui/_meta.ts defaults.
const PREF = {
  wanModel: "DaSiWa WAN 2.2 I2V 14B SnatchKiss v11.0 HIGH FP8 - Wan2.2.safetensors",
  wanVae: "wan_2.1_vae.safetensors",
  // T5: bf16 required (LoadWanVideoT5TextEncoder rejects fp8 scaled models).
  // fp8 kept only as a last-resort fallback if bf16 is missing.
  t5Model: ["umt5-xxl-enc-bf16.safetensors", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"],
};

const PROMPT =
  "cinematic slow push-in, gentle wind, warm golden hour light, highly detailed";
const WIDTH = 832;
const HEIGHT = 480;
const FRAMES = 17;
const STEPS = 15;
const CFG = 6;
const SHIFT = 8;
const SEED = 12345;
const FPS = 16;

// ---------------------------------------------------------------------------
// Minimal PNG encoder (solid RGBA) so the script needs no external assets.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(w, h, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// ComfyUI helpers
// ---------------------------------------------------------------------------
function fail(msg) {
  console.error("✗", msg);
  console.log("WAN_VIDEO_SMOKE_EXIT:1");
  process.exit(1);
}

async function objectInfo(node) {
  const res = await fetch(`${BASE}/api/object_info/${node}`);
  if (!res.ok) fail(`object_info ${node} -> HTTP ${res.status}`);
  const j = await res.json();
  return j[node];
}

// Extract the list of valid values for a required combo input.
function modelNames(info, inputName) {
  const tuple = info?.input?.required?.[inputName];
  const arr = Array.isArray(tuple) ? tuple[0] : undefined;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === "string" ? x : x?.value ?? x?.name))
    .filter(Boolean);
}

// Pick the best model name: preferred (first that exists) else a pattern match.
function pickModel(names, preferred, pattern) {
  const prefs = Array.isArray(preferred) ? preferred : [preferred];
  for (const p of prefs) if (p && names.includes(p)) return p;
  if (pattern) {
    const m = names.find((n) => pattern.test(n));
    if (m) return m;
  }
  return names[0];
}

async function uploadPng(buf, name) {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buf)]), name);
  form.append("type", "input");
  const res = await fetch(`${BASE}/api/upload/image`, { method: "POST", body: form });
  if (!res.ok) fail(`upload failed: HTTP ${res.status} ${await res.text()}`);
  const j = await res.json();
  if (!j.name) fail("upload returned no name");
  return j.name;
}

// ---------------------------------------------------------------------------
async function main() {
  // 1) Validate + resolve model names against the live instance.
  const [wanInfo, vaeInfo, t5Info] = await Promise.all([
    objectInfo("WanVideoModelLoader"),
    objectInfo("WanVideoVAELoader"),
    objectInfo("LoadWanVideoT5TextEncoder"),
  ]);
  const wanNames = modelNames(wanInfo, "model");
  const vaeNames = modelNames(vaeInfo, "model_name");
  const t5Names = modelNames(t5Info, "model_name");

  const wanModel = pickModel(wanNames, PREF.wanModel, /wan.*i2v|i2v.*wan/i);
  const wanVae = pickModel(vaeNames, PREF.wanVae, /vae/i);
  const t5Model = pickModel(t5Names, PREF.t5Model, /umt5|t5/i);

  console.log("→ resolved models:");
  console.log(`   WAN : ${wanModel}`);
  console.log(`   VAE : ${wanVae}`);
  console.log(`   T5  : ${t5Model}`);

  if (!wanModel || !wanVae || !t5Model) {
    fail(
      `could not resolve model names (wan=${wanNames.length}, vae=${vaeNames.length}, t5=${t5Names.length})`
    );
  }

  // 2) Generate + upload a test start frame.
  const png = makePng(512, 288, [180, 120, 90]);
  const inputImg = await uploadPng(png, "wan_smoke_start.png");
  console.log(`→ uploaded start frame -> ${inputImg}`);

  // 3) Build the I2V graph (verified KJ WanVideoWrapper chain, no CLIP-Vision).
  const graph = {
    "1": {
      class_type: "WanVideoModelLoader",
      inputs: { model: wanModel, base_precision: "bf16", quantization: "disabled", load_device: "main_device" },
    },
    "2": { class_type: "WanVideoVAELoader", inputs: { model_name: wanVae, precision: "bf16" } },
    "3": { class_type: "LoadWanVideoT5TextEncoder", inputs: { model_name: t5Model, precision: "bf16" } },
    "4": {
      class_type: "WanVideoTextEncode",
      inputs: { positive_prompt: PROMPT, negative_prompt: "", t5: ["3", 0], force_offload: true },
    },
    "5": { class_type: "LoadImage", inputs: { image: inputImg } },
    "6": {
      class_type: "WanVideoImageToVideoEncode",
      inputs: {
        vae: ["2", 0],
        start_image: ["5", 0],
        width: WIDTH,
        height: HEIGHT,
        num_frames: FRAMES,
        noise_aug_strength: 0.0,
        start_latent_strength: 1.0,
        end_latent_strength: 1.0,
        force_offload: true,
      },
    },
    "7": {
      class_type: "WanVideoSampler",
      inputs: {
        model: ["1", 0],
        image_embeds: ["6", 0],
        text_embeds: ["4", 0],
        steps: STEPS,
        cfg: CFG,
        shift: SHIFT,
        seed: SEED,
        scheduler: "unipc",
        riflex_freq_index: 0,
        force_offload: true,
      },
    },
    "8": {
      class_type: "WanVideoDecode",
      inputs: {
        vae: ["2", 0],
        samples: ["7", 0],
        enable_vae_tiling: true,
        tile_x: 256,
        tile_y: 256,
        tile_stride_x: 64,
        tile_stride_y: 64,
      },
    },
    "9": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["8", 0],
        frame_rate: FPS,
        loop_count: 0,
        filename_prefix: "wan_smoke",
        format: "video/h264-mp4",
        pingpong: false,
        save_output: true,
      },
    },
  };

  // 4) Submit.
  console.log(`→ submitting I2V job to ${BASE}`);
  let res = await fetch(`${BASE}/api/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: CLIENT_ID }),
  });
  if (!res.ok) fail(`prompt submit failed: ${res.status} ${await res.text()}`);
  const { prompt_id } = await res.json();
  if (!prompt_id) fail("no prompt_id returned");
  console.log(`→ prompt_id=${prompt_id}`);

  // 5) Poll history.
  const deadline = Date.now() + 8 * 60 * 1000; // 8 min
  let entry;
  while (Date.now() < deadline) {
    const hist = await (await fetch(`${BASE}/api/history/${prompt_id}`)).json();
    entry = hist?.[prompt_id];
    if (entry) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!entry) fail("timed out waiting for history");

  if (entry.status?.status_str === "error") {
    const msgs = entry.status?.messages ?? [];
    const ex = msgs.find((m) => m?.[0] === "execution_error")?.[1];
    if (ex) {
      console.error("node_id:", ex.node_id, "| node_type:", ex.node_type, "| type:", ex.exception_type);
      console.error("traceback:\n" + (ex.traceback || []).join("\n"));
      fail(`execution_error: ${ex.exception_message}`);
    }
    fail("status=error");
  }

  // 6) Extract + download the video (VHS emits under `gifs`).
  const outputs = entry.outputs ?? {};
  const videos = [];
  for (const nodeOut of Object.values(outputs)) {
    if (Array.isArray(nodeOut?.images)) videos.push(...nodeOut.images);
    if (Array.isArray(nodeOut?.videos)) videos.push(...nodeOut.videos);
    if (Array.isArray(nodeOut?.gifs)) videos.push(...nodeOut.gifs);
  }
  if (!videos.length) fail("no video/gif output in history");
  console.log(`→ got ${videos.length} video output(s)`);

  const v = videos[0];
  const buf = await (
    await fetch(
      `${BASE}/api/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(
        v.subfolder ?? ""
      )}&type=${encodeURIComponent(v.type ?? "")}`
    )
  ).arrayBuffer();
  const size = Buffer.from(buf).length;
  console.log(`→ downloaded ${v.filename} (${size} bytes)`);
  if (size < 1024) fail(`output too small (${size} bytes)`);

  console.log("✓ local WAN I2V smoke passed");
  console.log("WAN_VIDEO_SMOKE_EXIT:0");
  process.exit(0);
}

main().catch((e) => fail(e?.stack || e?.message || String(e)));
