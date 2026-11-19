/**
 * 工坊 ComfyUI 通道两份进程内 memo 的失效语义（ISSUE #2194）。旧形状「首读即定终身」：失败话术让用户手改 `data/workshop-comfy-settings.json`，
 * 缓存却只在同进程 save 更新；`resolvedBase` 连「探测全落空」的缺省地址也缓存，换端口后整个进程钉死（`client.ts` 早有 `resetComfyBase()`）。
 * 钉三条：① settings 按 size+mtime 指纹比对，手改后必 miss；② base 仅网络层失败复位、HTTP 状态失败不复位（#685，OOM 的 500 也是活实例）；③ 探测全落空不缓存。
 */
import {
  mkdtempSync,
  readFileSync as readFileSyncSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asRecord } from "~/lib/is-record";
import { mergeSizePresetTable } from "~/lib/media/size-presets";
import {
  buildTxt2ImgWorkflow,
  createSettingsFileMemo,
  generateImageViaComfyUI,
  postComfyPrompt,
  resetWorkshopComfyBase,
  resolveComfyBase,
  sizeDimsForImage,
  substitutePlaceholders,
} from "./comfyui";

/* 生效表换桩（ISSUE #3972）：把 image 场景 16:9 / 1k 改成 1280×720（项目默认
 * 1024×576）。出图链路的宽高换算必须读这份现读的生效表，而不是编译进包的
 * 默认快照 —— 本文件里凡走到换算的用例都经这份桩拿表。 */
vi.mock("~/lib/media/size-preset-fs.server", async () => {
  const { mergeSizePresetTable: merge } = await import("~/lib/media/size-presets");
  return {
    loadSizePresetTable: () =>
      Promise.resolve(merge({ image: { "16:9 横屏": { "1k": { width: 1280, height: 720 } } } })),
  };
});

const tmpDirs: Array<string> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** fetch 替身：按路径分发。probe（/system_stats）与业务端点分开计数。 */
function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  const counts = { probe: 0, prompt: 0 };
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const isProbe = url.pathname === "/system_stats";
    if (isProbe) {
      counts.probe += 1;
    }
    if (url.pathname === "/api/prompt") {
      counts.prompt += 1;
    }
    return await handler(url);
  });
  vi.stubGlobal("fetch", mock);
  return { counts, mock };
}

function connectionRefused(): TypeError {
  return new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:8188");
}

describe("settings 文件的指纹 memo（手改文件要能被发现）", () => {
  it("save 之后手改磁盘内容 ⇒ 下一次 load 读到的是手改后的", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-memo-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "workshop-comfy-settings.json");
    const memo = createSettingsFileMemo(file);
    await memo.save({ checkpoint: "sd_xl.safetensors" });
    expect(memo.load().checkpoint).toBe("sd_xl.safetensors");

    /* 用户照本模块话术手改文件（绕过 save）。mtime 可能同毫秒 ⇒ 指纹里带 size：
     * 这里连内容带体积一起改，任一变化都足以让指纹失配。 */
    writeFileSync(file, JSON.stringify({ checkpoint: "hand_edited.safetensors" }, null, 2), "utf8");
    expect(memo.load().checkpoint).toBe("hand_edited.safetensors");
  });

  it("文件被删 ⇒ 缓存失效，load 回到空对象；仍不存在时不再反复重读", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-memo-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "workshop-comfy-settings.json");
    writeFileSync(file, '{"checkpoint":"a.safetensors"}', "utf8");
    let reads = 0;
    const memo = createSettingsFileMemo(file, {
      read: (f) => {
        reads += 1;
        return readFileSyncSync(f, "utf8");
      },
      fingerprint: (f) => {
        try {
          const st = statSync(f);
          return `${st.size}:${st.mtimeMs}`;
        } catch {
          return null;
        }
      },
      write: (f, content) => {
        writeFileSync(f, content, "utf8");
        return Promise.resolve();
      },
    });
    expect(memo.load().checkpoint).toBe("a.safetensors");
    rmSync(file);
    expect(memo.load()).toEqual({});
    const afterMiss = reads;
    expect(memo.load()).toEqual({});
    expect(reads).toBe(afterMiss);
  });

  it("save 后无手改 ⇒ load 命中缓存，不重读文件", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-memo-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "workshop-comfy-settings.json");
    let reads = 0;
    const memo = createSettingsFileMemo(file, {
      read: (f) => {
        reads += 1;
        return readFileSyncSync(f, "utf8");
      },
      fingerprint: () => null,
      write: (f, content) => {
        writeFileSync(f, content, "utf8");
        return Promise.resolve();
      },
    });
    await memo.save({ checkpoint: "a.safetensors" });
    memo.load();
    memo.load();
    expect(reads).toBe(1);
  });
});

describe("base 缓存的失效语义（网络失败复位 / HTTP 失败不复位 / 探空不缓存）", () => {
  beforeEach(() => {
    /* 模块级 memo 跨用例残留：每条从「还没探过」开始（生产形态里它本来就
     * 由失败路径复位 —— 这里测的正是那个语义）。 */
    resetWorkshopComfyBase();
  });

  it("网络层失败 ⇒ 复位缓存：下一次调用重新探测（probe 计数 +1）", async () => {
    vi.stubEnv("COMFYUI_BASE", "http://127.0.0.1:8188");
    let promptShouldFailWithNetwork = false;
    const { counts } = stubFetch((url) => {
      if (url.pathname === "/api/prompt") {
        if (promptShouldFailWithNetwork) {
          throw connectionRefused();
        }
        return Response.json({ prompt_id: "p1" });
      }
      return Response.json({}); // /system_stats：连上即存活（#685 口径）
    });
    await resolveComfyBase();
    const probesAfterFirst = counts.probe;
    expect(probesAfterFirst).toBeGreaterThanOrEqual(1);

    promptShouldFailWithNetwork = true;
    await expect(postComfyPrompt({})).rejects.toBeInstanceOf(TypeError);
    promptShouldFailWithNetwork = false;
    await postComfyPrompt({});
    expect(counts.probe).toBeGreaterThan(probesAfterFirst);
  });

  it("HTTP 状态失败（连上了但实例报错）⇒ 不复位：不重探，直接用同一 base", async () => {
    vi.stubEnv("COMFYUI_BASE", "http://127.0.0.1:8188");
    let promptStatus = 200;
    const { counts } = stubFetch((url) => {
      if (url.pathname === "/api/prompt") {
        return Response.json({ error: "CUDA out of memory" }, { status: promptStatus });
      }
      return Response.json({});
    });
    await resolveComfyBase();
    const probesAfterFirst = counts.probe;

    promptStatus = 500;
    await expect(postComfyPrompt({})).rejects.toThrow("/api/prompt 失败 (500)");
    promptStatus = 200;
    await postComfyPrompt({});
    // GPU OOM 的 500 也是活实例（#685）⇒ base 仍可信，一次探测都不多发。
    expect(counts.probe).toBe(probesAfterFirst);
  });

  it("探测全落空 ⇒ 不缓存：下一次调用整轮重探（谁都没应答就别钉死在缺省地址上）", async () => {
    vi.stubEnv("COMFYUI_BASE", "http://127.0.0.1:8188");
    const { counts } = stubFetch(() => {
      throw connectionRefused();
    });
    await resolveComfyBase();
    const probesAfterFirst = counts.probe;
    expect(probesAfterFirst).toBeGreaterThanOrEqual(6); // 配置端口起连扫 6 个偏移
    await resolveComfyBase();
    expect(counts.probe).toBeGreaterThanOrEqual(probesAfterFirst + 6);
  });
});

/* ── 尺寸换算按生效表（ISSUE #3972）────────────────────────────── */

describe("尺寸换算按生效表（ISSUE #3972）", () => {
  const size169 = { ratio: "16:9 横屏", clarity: "1k", multiple: 64 } as const;
  /** 与顶部桩同源的生效表（image 16:9 / 1k = 1280×720）。 */
  const effectiveTable = () =>
    mergeSizePresetTable({ image: { "16:9 横屏": { "1k": { width: 1280, height: 720 } } } });

  it("sizeDimsForImage：显式传表按表算；缺省回落编译进包的项目默认", () => {
    expect(sizeDimsForImage(size169, effectiveTable())).toEqual({ width: 1280, height: 720 });
    expect(sizeDimsForImage(size169)).toEqual({ width: 1024, height: 576 });
  });

  it("buildTxt2ImgWorkflow：EmptyLatentImage 的宽高按生效表算", () => {
    const wf = asRecord(
      buildTxt2ImgWorkflow({ prompt: "x", size: size169, table: effectiveTable() }),
    );
    const latent = Object.values(wf ?? {}).find(
      (node) => asRecord(node)?.class_type === "EmptyLatentImage",
    );
    expect(asRecord(asRecord(latent)?.inputs)?.width).toBe(1280);
    expect(asRecord(asRecord(latent)?.inputs)?.height).toBe(720);
  });

  it("generateImageViaComfyUI：先现读生效表，再按它算宽高", async () => {
    resetWorkshopComfyBase();
    let posted: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.pathname === "/system_stats") {
          return new Response("{}", { status: 200 });
        }
        if (url.pathname === "/api/prompt") {
          /* 捕获提交的工作流；应答不带 prompt_id ⇒ 链路在校验处止步，不写任何输出文件。 */
          posted = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    await expect(generateImageViaComfyUI({ prompt: "x", size: size169 })).rejects.toThrow(
      /prompt_id/,
    );
    const workflow = asRecord(asRecord(posted)?.prompt);
    const latent = Object.values(workflow ?? {}).find(
      (node) => asRecord(node)?.class_type === "EmptyLatentImage",
    );
    /* 桩里的生效表把 16:9 / 1k 改成了 1280×720 —— 下发给 ComfyUI 的必须是它。 */
    expect(asRecord(asRecord(latent)?.inputs)?.width).toBe(1280);
    expect(asRecord(asRecord(latent)?.inputs)?.height).toBe(720);
  });
});

describe("substitutePlaceholders（#4414）", () => {
  const template = {
    nodes: {
      "1": { class_type: "KSampler", inputs: { text: "{{prompt}}", neg: "{{negative}}" } },
      "2": { class_type: "LoadImage", inputs: { image: "{{image}}" } },
    },
  };

  it("提示词含引号/反斜杠/换行：按值替换，不再炸 JSON 解析", () => {
    const prompt = 'a "quoted" scene \\ with\nnewlines 和中文';
    const out = asRecord(substitutePlaceholders(template, { prompt, negative: 'neg "x"' }))!;
    const node1 = asRecord(asRecord(out.nodes)?.["1"])!;
    const inputs1 = asRecord(node1.inputs)!;
    expect(inputs1.text).toBe(prompt);
    expect(inputs1.neg).toBe('neg "x"');
  });

  it("缺省的 negative / image 替换为空串；非字符串字段原样保留", () => {
    const out = asRecord(substitutePlaceholders(template, { prompt: "p" }))!;
    const node1 = asRecord(asRecord(out.nodes)?.["1"])!;
    const node2 = asRecord(asRecord(out.nodes)?.["2"])!;
    const inputs1 = asRecord(node1.inputs)!;
    const inputs2 = asRecord(node2.inputs)!;
    expect(inputs1.neg).toBe("");
    expect(inputs2.image).toBe("");
    expect(node2.class_type).toBe("LoadImage");
  });

  it("字符串形态的模板：先解析再替换", () => {
    const out = asRecord(substitutePlaceholders(JSON.stringify(template), { prompt: "p" }))!;
    const node1 = asRecord(asRecord(out.nodes)?.["1"])!;
    expect(asRecord(node1.inputs)!.text).toBe("p");
  });

  it("非法 JSON 字符串模板：给可读错误，不抛裸 SyntaxError", () => {
    expect(() => substitutePlaceholders("{not-json", { prompt: "p" })).toThrow(
      /工作流模板不是合法 JSON/,
    );
  });
});
