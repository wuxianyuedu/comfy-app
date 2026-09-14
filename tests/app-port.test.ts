import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  derivePortFromPath,
  FALLBACK_PORT,
  fnv1a32,
  normalizeRootForPort,
  readEnvPort,
  resolveAppPort,
} from "../scripts/app-port.mjs";

/**
 * 应用端口解析契约（launch-and-build.md §1.1 / §1.4 多检出并行）。
 *
 * 推导算法是多语言约定（PowerShell / Python / Rust 各有同型实现），这里锁住
 * Node 侧行为与固定校验向量——向量由真实路径生成，四侧实现对同一输入必须
 * 得出同一端口，改动算法前先想清楚多检出并行会怎么被破坏。
 */
describe("app-port 端口解析", () => {
  it("路径规范化：反斜杠转正斜杠 + 转小写 + resolve", () => {
    expect(normalizeRootForPort("F:\\AI\\Other\\comfy-app-t3-branch")).toBe(
      "f:/ai/other/comfy-app-t3-branch",
    );
  });

  it("FNV-1a 32 位对固定输入给出稳定向量（跨语言一致性锚点）", () => {
    expect(fnv1a32("f:/ai/other/comfy-app-t3-branch")).toBe(0x97ecb3a9);
  });

  it("按检出路径推导的端口落在 3200..3999，且同路径恒定、异路径可分", () => {
    const a = derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch");
    const again = derivePortFromPath("F:/AI/Other/comfy-app-t3-branch");
    const b = derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch2");
    expect(a).toBe(3305);
    expect(again).toBe(a); // 同一检出（分隔符/大小写差异）必须同一端口
    expect(b).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(3200);
    expect(a).toBeLessThanOrEqual(3999);
  });

  it(".env 显式 COMFYAPP_PORT 优先于路径推导", () => {
    // 本仓库真实的 .env 显式钉了 COMFYAPP_PORT（开发者的主检出保持 3100），
    // 因此这里用临时目录造 .env 验证优先级，不依赖仓库当前配置。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-"));
    try {
      fs.writeFileSync(path.join(tmp, ".env"), 'COMFYAPP_PORT="4321"\n', "utf8");
      expect(readEnvPort(tmp)).toBe(4321);
      expect(resolveAppPort(tmp)).toBe(4321);

      fs.writeFileSync(path.join(tmp, ".env"), "COMFYAPP_PORT=not-a-number\n", "utf8");
      expect(readEnvPort(tmp)).toBeNull();
      expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));

      fs.writeFileSync(path.join(tmp, ".env"), "", "utf8");
      expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("规范化与 cwd 无关：绝对路径原样处理，不拼当前工作目录", () => {
    // 回归锁：历史实现无条件 path.resolve()，而它的语义是「相对 cwd 解析」——
    // 在 Linux 上 path.resolve("F:\\AI\\...") 会得到 /workspace/f:/ai/...，
    // 同一检出在不同 cwd / 不同平台推出不同端口，「同一检出恒定同端口」失效。
    const win = "F:\\AI\\Other\\comfy-app-t3-branch";
    const cwd = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(normalizeRootForPort(win)).toBe("f:/ai/other/comfy-app-t3-branch");
      expect(derivePortFromPath(win)).toBe(3305);
    } finally {
      process.chdir(cwd);
    }
    // 回到本仓库 cwd 后仍是同一个值。
    expect(normalizeRootForPort(win)).toBe("f:/ai/other/comfy-app-t3-branch");
  });

  it("尾斜杠与分隔符写法不影响端口（POSIX 检出同样稳定）", () => {
    expect(normalizeRootForPort("/workspace/")).toBe("/workspace");
    expect(derivePortFromPath("/workspace/")).toBe(derivePortFromPath("/workspace"));
  });

  it(".env 缺失时按路径推导而不是撞默认端口（多检出并行的前提）", () => {
    const missing = path.join(os.tmpdir(), "definitely-not-existing-checkout");
    expect(readEnvPort(missing)).toBeNull();
    expect(resolveAppPort(missing)).toBe(derivePortFromPath(missing));
    expect(FALLBACK_PORT).toBe(3100);
  });
});
