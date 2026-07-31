// Local WAN image-to-video smoke test (no cloud, no authorization).
//
// Submits the verified KJ WanVideoWrapper I2V chain to the local ComfyUI
// instance, polls until done, then downloads the emitted video (VHS outputs
// under `gifs`) and asserts it is a non-trivial file.
//
//   node scripts/wan-video-smoke.mjs
//
// Prints WAN_VIDEO_SMOKE_EXIT:0 on success, WAN_VIDEO_SMOKE_EXIT:1 on failure.

const BASE = process.env.COMFYUI_BASE || "http://127.0.0.1:8188";
const CLIENT_ID = "wan-video-smoke";

const WAN_MODEL =
  "DaSiWa WAN 2.2 I2V 14B SnatchKiss v11.0 HIGH FP8 - Wan2.2.safetensors";
const WAN_VAE = "wan_2.1_vae.safetensors";
const T5_MODEL = "umt5-xxl-enc-bf16.safetensors";
const CLIP_VISION = "dino_v3_vit_h.safetensors";
// An image already present in ComfyUI's input dir (no upload needed).
const INPUT_IMG = "white-hotel-on-rocky-island.png";

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

const graph = {
  "1": {
    class_type: "WanVideoModelLoader",
    inputs: { model: WAN_MODEL, base_precision: "bf16", quantization: "disabled", load_device: "main_device" },
  },
  "2": { class_type: "WanVideoVAELoader", inputs: { model_name: WAN_VAE, precision: "bf16" } },
  "3": { class_type: "LoadWanVideoT5TextEncoder", inputs: { model_name: T5_MODEL, precision: "bf16" } },
  "4": {
    class_type: "WanVideoTextEncode",
    inputs: { positive_prompt: PROMPT, negative_prompt: "", t5: ["3", 0], force_offload: true },
  },
  "5": { class_type: "LoadImage", inputs: { image: INPUT_IMG } },
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
      enable_vae_tiling: false,
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

function fail(msg) {
  console.error("✗", msg);
  console.log("WAN_VIDEO_SMOKE_EXIT:1");
  process.exit(1);
}

async function main() {
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
