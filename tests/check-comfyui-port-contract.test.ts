/**
 * ComfyUI 端口口径门禁的自测（ISSUE #534 P1）。
 *
 * 为什么要有：这条门禁的价值全在**判定口径**上——它必须能拦下「默认端口被改回
 * 硬编码 / 两侧各写一份数字」，同时不误伤注释里解释历史口径的那两行。用「临时
 * 仓库 + 只放被测文件」跑真脚本，断言「该拦的拦、不该误伤的放过」，避免门禁
 * 自己变成误报源（成员会直接删掉误报的门禁，等于没有）。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  __dirname,
  "../scripts/check-comfyui-port-contract.cjs",
);
const tempDirs: string[] = [];

/** 与真实仓库保持一致的四个判据文件（只保留被判据读到的部分）。 */
const BASELINE_FILES: Record<string, string> = {
  "src/lib/endpoints.ts":
    'export const COMFYUI_DEFAULT_PORT = 8188;\nexport function comfyUiBaseUrl(port: number = COMFYUI_DEFAULT_PORT): string {\n  return `http://127.0.0.1:${port}`;\n}\n',
  "src/lib/app-settings.ts":
    'export { COMFYUI_DEFAULT_PORT } from "./endpoints";\n',
  "src/lib/comfyui/client.ts": `import { COMFYUI_DEFAULT_PORT } from "../app-settings";
export function resolveComfyBase() {
  return COMFYUI_DEFAULT_PORT;
}
`,
  "src/lib/comfyui/lifecycle.ts": `import { COMFYUI_DEFAULT_PORT } from "../app-settings";
import { buildSpawnArgs } from "./lifecycle-derive";
export function launch() {
  return buildSpawnArgs({ baseArgs: [], effectivePort: 0, defaultPort: COMFYUI_DEFAULT_PORT, extraArgs: [] });
}
`,
  "src/lib/comfyui/lifecycle-derive.ts": `export function buildSpawnArgs(facts: { baseArgs: string[]; effectivePort: number | undefined; defaultPort: number; extraArgs: string[] }) {
  const port = facts.effectivePort && facts.effectivePort > 0 ? facts.effectivePort : facts.defaultPort;
  return [...facts.baseArgs, ...(port !== facts.defaultPort ? ["--port", String(port)] : []), ...facts.extraArgs];
}
`,
  "src/lib/comfyui/desktop-instance.ts": `export function resolveEffectiveLaunch() {
  return { port: 0 }; // 0 → 调用方按 COMFYUI_DEFAULT_PORT 兜底
}
`,
};

/** 造一个只含被测文件的临时仓库（脚本按自身位置解析仓库根）。 */
function scanner(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "comfyui-port-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  const files = { ...BASELINE_FILES, ...overrides };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const run = (): { ok: boolean; output: string } => {
    try {
      return {
        ok: true,
        output: execFileSync(
          process.execPath,
          [path.join(root, "scripts", path.basename(SCRIPT))],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };
  return { run, root };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check-comfyui-port-contract", () => {
  it("口径一致时放行（含注释里解释历史口径的 :8188 不误报）", () => {
    const { run } = scanner({
      "src/lib/comfyui/foo.ts": `// 历史口径：曾经散落 5 处 :8188，现在走 COMFYUI_DEFAULT_PORT\nexport const x = 1;\n`,
    });
    expect(run().ok).toBe(true);
  });

  it("连接侧不再共用默认端口常量（改回硬编码）即阻断", () => {
    const { run } = scanner({
      "src/lib/comfyui/client.ts": `export function resolveComfyBase() {
  return 8188;
}
`,
    });
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.output).toContain("client.ts");
  });

  it("拉起侧注入别的默认端口即阻断", () => {
    const { run } = scanner({
      "src/lib/comfyui/lifecycle.ts": `import { COMFYUI_DEFAULT_PORT } from "../app-settings";
import { buildSpawnArgs } from "./lifecycle-derive";
export function launch() {
  return buildSpawnArgs({ baseArgs: [], effectivePort: 0, defaultPort: 9000, extraArgs: [] });
}
`,
    });
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.output).toContain("defaultPort");
  });

  it("buildSpawnArgs 改成无条件补 --port 即阻断（会污染「显示端口 = 监听端口」）", () => {
    const { run } = scanner({
      "src/lib/comfyui/lifecycle-derive.ts": `export function buildSpawnArgs(facts: { baseArgs: string[]; effectivePort: number | undefined; defaultPort: number; extraArgs: string[] }) {
  const port = facts.effectivePort ?? facts.defaultPort;
  return [...facts.baseArgs, "--port", String(port), ...facts.extraArgs];
}
`,
    });
    expect(run().ok).toBe(false);
  });

  it("源码里出现裸 8188 字面量即阻断", () => {
    const { run } = scanner({
      "src/lib/comfyui/foo.ts": `export const BASE = "http://127.0.0.1:8188";\n`,
    });
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.output).toContain("foo.ts");
  });

  it("定义默认端口的那一行本身不算裸字面量", () => {
    const { run } = scanner({
      "src/lib/endpoints.ts":
        'export const COMFYUI_DEFAULT_PORT = 8188;\nexport function comfyUiBaseUrl(port: number = COMFYUI_DEFAULT_PORT): string {\n  return `http://127.0.0.1:${port}`;\n}\n',
    });
    expect(run().ok).toBe(true);
  });

  it("常量改在 app-settings.ts 里自己定义（而不是再导出）即阻断", () => {
    const { run } = scanner({
      "src/lib/app-settings.ts":
        'export const COMFYUI_DEFAULT_PORT = 8188;\n',
    });
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.output).toContain("再导出");
  });

  it("零依赖常量层缺定义即阻断（浏览器图会因 import fs 整页 500）", () => {
    const { run } = scanner({
      "src/lib/endpoints.ts":
        'export function comfyUiBaseUrl(port: number): string {\n  return `http://127.0.0.1:${port}`;\n}\n',
    });
    expect(run().ok).toBe(false);
  });
});
