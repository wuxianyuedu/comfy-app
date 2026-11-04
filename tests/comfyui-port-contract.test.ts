/**
 * ComfyUI 端口口径一致性（ISSUE #534 P1）。「同一事实多份实现」是反复出事故的模式：8188 原散在 `resolveComfyBase()` 硬编码、
 * `resolveEffectiveLaunch()`/`buildSpawnArgs()` 的「0 = 未配置」、`config.ts` schema 默认值与错误文案四处，改一处都不变红，只在真机
 * 表现成「探到了但不是你要的实例」。补断言：① 单点定义两侧共用；② 空配置同默认端口；③ 仅有效端口 ≠ 默认才补 `--port`；④ config 兜底由端点模块拼出。脚本版 `check-comfyui-port-contract.cjs` 已接 pre-commit 与 CI。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMFYUI_DEFAULT_PORT, LOOPBACK_HOST, comfyUiBaseUrl } from "~/lib/endpoints";
import { buildSpawnArgs } from "~/lib/comfyui/lifecycle-derive";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("默认端口是单一事实源", () => {
  it("COMFYUI_DEFAULT_PORT 是正整数（常量被删/改成 0 都会让两侧的兜底失据）", () => {
    expect(Number.isInteger(COMFYUI_DEFAULT_PORT)).toBe(true);
    expect(COMFYUI_DEFAULT_PORT).toBeGreaterThan(0);
    expect(COMFYUI_DEFAULT_PORT).toBeLessThanOrEqual(65_535);
  });

  it("常量只定义在零依赖的 endpoints.ts；app-settings 不再转手它", () => {
    const endpoints = read("src/lib/endpoints.ts");
    expect(endpoints).toMatch(/export\s+const\s+COMFYUI_DEFAULT_PORT\s*=\s*\d+\s*;/);
    // app-settings 带 fs：它的定义进不了浏览器图（ISSUE #282/#317）
    expect(endpoints).not.toMatch(/^import\s/m);
    // 端口常量只有一个出口；应用设置那一侧（含它的 IO 拆件）不得转手
    for (const file of [
      "src/lib/app-settings/index.ts",
      "src/lib/app-settings/app-settings.server.ts",
    ]) {
      const settings = read(file);
      expect(settings).not.toMatch(/export\s+const\s+COMFYUI_DEFAULT_PORT\s*=/);
      expect(settings).not.toMatch(/export\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from/);
    }
  });

  /* 连接侧与拉起侧都从**零依赖常量层**取默认端口（判据见
   * `scripts/check-comfyui-port-contract.cjs`）：转手一次就多一条「只想要一个
   * 常量却拖进 fs」的路径，而那条路径正是设置页整页 500 的成因。 */
  it("连接侧（client.ts）与拉起侧（lifecycle-launch.ts）都从常量层取默认端口", () => {
    for (const file of ["src/lib/comfyui/client.ts", "src/lib/comfyui/lifecycle-launch.ts"]) {
      const src = read(file);
      expect(src, `${file} 应从 ../endpoints 取 COMFYUI_DEFAULT_PORT`).toMatch(
        /import\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from\s*"\.\.\/endpoints"/,
      );
    }
    expect(read("src/lib/comfyui/lifecycle-launch.ts")).toMatch(
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
    expect(comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)).toContain(String(COMFYUI_DEFAULT_PORT));
  });
});

describe("源码里不再有第二份默认端口口径（§12.14）", () => {
  it("config.ts 的 ComfyUI 兜底地址走端点模块，不写裸地址", () => {
    const src = read("src/lib/core/config.ts");
    expect(src).toMatch(/import\s*\{[^}]*COMFYUI_DEFAULT_PORT[^}]*\}\s*from\s*"\.\.\/endpoints"/);
    expect(src).toMatch(/import\s*\{[^}]*comfyUiBaseUrl[^}]*\}\s*from\s*"\.\.\/endpoints"/);
    /* 默认值走 `CONFIG_ENV_DEFAULTS`（ISSUE #568）：裸地址/裸端口在 config.ts 里
     * 仍只有一处，且那一处本身取自 endpoints.ts —— 等价于原来的直接字面量写法。 */
    expect(src).toMatch(/comfyuiBaseUrl:\s*comfyUiBaseUrl\(COMFYUI_DEFAULT_PORT\)/);
    expect(src).toMatch(/default\(CONFIG_ENV_DEFAULTS\.comfyuiBaseUrl\)/);
    expect(src).not.toMatch(/127\.0\.0\.1:8188/);
  });
});
