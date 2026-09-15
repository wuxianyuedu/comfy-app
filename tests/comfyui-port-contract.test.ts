/**
 * ComfyUI 端口口径一致性（ISSUE #534 P1）
 * ===========================================================================
 *
 * 「同一个事实有多份实现」是本仓库反复出事故的模式（因此有了端口向量一致性、
 * 主题色棘轮、端点收口等门禁）。ComfyUI 的**默认端口**此前正是这样一处：
 *
 *   · 连接侧 `resolveComfyBase()` 把 `comfyuiPort: 0` 判为「未配置」→ 用 8188
 *     作为探测起点，而 8188 是**硬编码**在 client.ts 里的；
 *   · 拉起侧 `resolveEffectiveLaunch()` / `buildSpawnArgs()` 也把 `0` 当
 *     「未配置」→ 不传 `--port`，ComfyUI 用它自己的默认端口启动；
 *   · 另外还有第三、第四份：`lib/core/config.ts` 的 schema 默认值写了
 *     `http://127.0.0.1:8188`，错误提示文案里也各写了一遍。
 *
 * 四处都写 8188，看着「一致」，但**没有一条断言**把它们绑在一起：任何一处单独
 * 改动（改常量、改硬编码、改 schema 默认值）都不会有测试变红，只会在真机上
 * 表现成「探到了、但不是你要的那个实例」——随后报出的是上传失败 / 端口漂移
 * 这类**现象**，根因被埋掉（规范 §5 最忌讳的那类故障）。
 *
 * 本文件补上这层断言：
 *   ① 默认端口单点定义，连接侧 / 拉起侧共用同一常量（不各写一份数字）；
 *   ② 「配置端口为空」在两侧都落到同一个默认端口；
 *   ③ `buildSpawnArgs` 的口径：只在有效端口 ≠ 默认端口时才补 `--port`；
 *   ④ `config.ts` 的 ComfyUI 兜底地址由端点模块拼出，不再写裸地址。
 *
 * 脚本版（不装依赖也能跑）见 `scripts/check-comfyui-port-contract.cjs`，
 * 已接入 pre-commit 与 CI。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMFYUI_DEFAULT_PORT,
  LOOPBACK_HOST,
  comfyUiBaseUrl,
} from "~/lib/endpoints";
import { buildSpawnArgs } from "~/lib/comfyui/lifecycle-derive";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("默认端口是单一事实源", () => {
  it("COMFYUI_DEFAULT_PORT 是正整数（常量被删/改成 0 都会让两侧的兜底失据）", () => {
    expect(Number.isInteger(COMFYUI_DEFAULT_PORT)).toBe(true);
    expect(COMFYUI_DEFAULT_PORT).toBeGreaterThan(0);
    expect(COMFYUI_DEFAULT_PORT).toBeLessThanOrEqual(65535);
  });

  it("常量定义在零依赖的 endpoints.ts；app-settings.ts 只再导出（不自己定义）", () => {
    const endpoints = read("src/lib/endpoints.ts");
    expect(endpoints).toMatch(
      /export\s+const\s+COMFYUI_DEFAULT_PORT\s*=\s*\d+\s*;/,
    );
    // app-settings.ts 顶层 import fs：它的定义进不了浏览器图（ISSUE #282/#317）
    expect(endpoints).not.toMatch(/^import\s/m);
    const settings = read("src/lib/app-settings.ts");
    expect(settings).toMatch(
      /export\s*\{\s*COMFYUI_DEFAULT_PORT\s*\}\s*from\s*"\.\/endpoints"/,
    );
    expect(settings).not.toMatch(/export\s+const\s+COMFYUI_DEFAULT_PORT\s*=/);
  });

  it("连接侧（client.ts）导入的是同一个常量，不是自己写的数字", () => {
    const src = read("src/lib/comfyui/client.ts");
    expect(src).toMatch(
      /import\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from\s*"\.\.\/app-settings"/,
    );
  });

  it("拉起侧（lifecycle-launch.ts）注入的就是同一个常量", () => {
    const src = read("src/lib/comfyui/lifecycle-launch.ts");
    expect(src).toMatch(
      /import\s*\{[\s\S]*?COMFYUI_DEFAULT_PORT[\s\S]*?\}\s*from\s*"\.\.\/app-settings"/,
    );
    expect(src).toMatch(
      /buildSpawnArgs\(\{[\s\S]{0,400}?defaultPort:\s*COMFYUI_DEFAULT_PORT/,
    );
  });

  it("comfyUiBaseUrl 缺省参数就是默认端口（调用方不必各写一遍端口）", () => {
    expect(comfyUiBaseUrl()).toBe(comfyUiBaseUrl(COMFYUI_DEFAULT_PORT));
  });

  it("本机 ComfyUI 默认地址由端点模块拼出（回环主机 + 默认端口）", () => {
    expect(comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)).toBe(
      `http://${LOOPBACK_HOST}:${COMFYUI_DEFAULT_PORT}`,
    );
    // §12.14：回环主机写 127.0.0.1，不写 localhost（Node fetch 会先解析成 ::1）
    expect(comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)).not.toContain("localhost");
  });
});

describe("「未配置端口」在两侧落到同一个默认端口", () => {
  it("buildSpawnArgs：端口为 0/undefined 时按默认端口，且不补 --port", () => {
    for (const effectivePort of [0, undefined]) {
      const args = buildSpawnArgs({
        baseArgs: ["main.py"],
        effectivePort,
        defaultPort: COMFYUI_DEFAULT_PORT,
        extraArgs: [],
      });
      expect(args).not.toContain("--port");
      expect(args).toContain("main.py");
    }
  });

  it("buildSpawnArgs：显式端口与默认端口相同时同样不补 --port（避免污染对照关系）", () => {
    const args = buildSpawnArgs({
      baseArgs: ["main.py"],
      effectivePort: COMFYUI_DEFAULT_PORT,
      defaultPort: COMFYUI_DEFAULT_PORT,
      extraArgs: [],
    });
    expect(args).not.toContain("--port");
  });

  it("buildSpawnArgs：非默认端口必须显式传 --port <n>（界面显示端口 = 实际监听端口）", () => {
    const custom = COMFYUI_DEFAULT_PORT + 7;
    const args = buildSpawnArgs({
      baseArgs: ["main.py"],
      effectivePort: custom,
      defaultPort: COMFYUI_DEFAULT_PORT,
      extraArgs: [],
    });
    expect(args).toContain("--port");
    expect(args[args.indexOf("--port") + 1]).toBe(String(custom));
  });

  it("两侧对「未配置」的兜底是同一个数字：拉起侧用 defaultPort，端点侧用它拼地址", () => {
    const launchedNeedsPort = !buildSpawnArgs({
      baseArgs: [],
      effectivePort: 0,
      defaultPort: COMFYUI_DEFAULT_PORT,
      extraArgs: [],
    }).includes("--port");
    // 拉起侧不传 --port ⇒ ComfyUI 以它自己的默认端口启动 = COMFYUI_DEFAULT_PORT
    // ⇒ 连接侧必须用同一个值兜底，否则「配置留空」就会连到另一个实例上。
    expect(launchedNeedsPort).toBe(true);
    expect(comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)).toContain(
      String(COMFYUI_DEFAULT_PORT),
    );
  });
});

describe("源码里不再有第二份默认端口口径（§12.14）", () => {
  it("config.ts 的 ComfyUI 兜底地址走端点模块，不写裸地址", () => {
    const src = read("src/lib/core/config.ts");
    expect(src).toMatch(
      /import\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from\s*"\.\.\/endpoints"/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*comfyUiBaseUrl[^}]*\}\s*from\s*"\.\.\/endpoints"/,
    );
    /* 默认值走 `CONFIG_ENV_DEFAULTS`（ISSUE #568）：裸地址/裸端口在 config.ts 里
     * 仍只有一处，且那一处本身取自 endpoints.ts —— 等价于原来的直接字面量写法。 */
    expect(src).toMatch(
      /comfyuiBaseUrl:\s*comfyUiBaseUrl\(COMFYUI_DEFAULT_PORT\)/,
    );
    expect(src).toMatch(/default\(CONFIG_ENV_DEFAULTS\.comfyuiBaseUrl\)/);
    expect(src).not.toMatch(/127\.0\.0\.1:8188/);
  });
});
