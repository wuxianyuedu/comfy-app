/**
 * 工坊 ComfyUI 通道两份进程内 memo 的**失效语义**（ISSUE #2194）。
 *
 * 此前的形状是「首读即定终身」：`settingsCache` 只在同进程写路径（save）里更新 ——
 * 而本模块的失败话术**指名让用户手改** `data/workshop-comfy-settings.json`，
 * 提示与缓存互相推翻；`resolvedBase` 则把「探测全落空」的缺省地址也缓存，
 * ComfyUI 重启换端口后整个进程生命周期钉死在死端口上（同维度的
 * `client.ts` 那一侧早有 `resetComfyBase()`，理由写的就是这件事）。
 *
 * 本文件钉住三条新语义：
 *   ① settings 缓存按 **size+mtime 指纹**比对 —— 手改文件的下一次读取必然
 *      miss（执行者 = 手改这个动作本身）；
 *   ② base 缓存在**网络层失败**时复位（执行者 = 本模块自己的 fetch 失败路径），
 *      而 **HTTP 状态失败不复位** —— 连上即存活（#685），GPU OOM 的 500 也是活实例；
 *   ③ 探测全落空**不缓存** —— 与 client.ts 同一句：「谁都没应答」不缓存，
 *      实例随时可能起来。
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

import {
  createSettingsFileMemo,
  postComfyPrompt,
  resetWorkshopComfyBase,
  resolveComfyBase,
} from "./comfyui";

const tmpDirs: Array<string> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
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
    writeFileSync(
      file,
      JSON.stringify({ checkpoint: "hand_edited.safetensors" }, null, 2),
      "utf-8",
    );
    expect(memo.load().checkpoint).toBe("hand_edited.safetensors");
  });

  it("文件被删 ⇒ 缓存失效，load 回到空对象；仍不存在时不再反复重读", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-memo-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "workshop-comfy-settings.json");
    writeFileSync(file, '{"checkpoint":"a.safetensors"}', "utf-8");
    let reads = 0;
    const memo = createSettingsFileMemo(file, {
      fingerprint: (f) => {
        try {
          const st = statSync(f);
          return `${st.size}:${st.mtimeMs}`;
        } catch {
          return null;
        }
      },
      read: (f) => {
        reads += 1;
        return readFileSyncSync(f, "utf-8");
      },
      write: async (f, content) => writeFileSync(f, content, "utf-8"),
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
      fingerprint: () => null,
      read: (f) => {
        reads += 1;
        return readFileSyncSync(f, "utf-8");
      },
      write: async (f, content) => writeFileSync(f, content, "utf-8"),
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
