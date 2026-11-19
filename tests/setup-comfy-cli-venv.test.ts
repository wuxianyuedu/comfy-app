import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** ISSUE #4521：工作区 MCP 服务器 `comfy-mcp` 的入口 exe 由 PyPI 包 `comfy-mcp`
 * 提供，而 venv 引导脚本过去只装 comfy-cli —— 配置在、执行者不在。这里锁住
 * 「引导脚本把 comfy-mcp 一并就位」的形状：脚本没有可独立导出的纯函数
 * （main 只在直跑时执行，端到端要真建 venv + 联网装包），按本仓对这类脚本的
 * 既有口径（ci-env-probe.test.ts）做源形状判据。 */
describe("setup-comfy-cli-venv：comfy-mcp 随 venv 引导就位（#4521）", () => {
  const mjs = read("scripts/devtools/setup-comfy-cli-venv.mjs");

  it("幂等判据与 comfy_cli 同形：import comfy_mcp 探测", () => {
    expect(
      mjs.includes("import comfy_mcp"),
      "缺了要能自动补装，前提是先有 import comfy_mcp 的可导入性探测",
    ).toBe(true);
  });

  it("安装步骤落在 .mjs：pip install comfy-mcp", () => {
    expect(
      mjs.includes('"install", "comfy-mcp"'),
      "应经 runStep 跑 pip install comfy-mcp，不许另起安装通道",
    ).toBe(true);
  });

  it("venv 首建与已就绪两条路径都调用 ensureComfyMcpInstalled", () => {
    const calls = mjs.match(/ensureComfyMcpInstalled\(\)/g) ?? [];
    expect(
      calls.length,
      "旧检出的 venv 里可能没有 comfy-mcp，只有首建路径装会导致永远补不上",
    ).toBeGreaterThanOrEqual(2);
  });

  it("薄壳 .ps1 不长出 comfy-mcp 逻辑（编排只在 .mjs，硬规则 12）", () => {
    expect(read("scripts/devtools/setup-comfy-cli-venv.ps1").includes("comfy-mcp")).toBe(false);
  });
});
