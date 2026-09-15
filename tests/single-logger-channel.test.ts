/**
 * 回归护栏：**日志实现只有一处**（ISSUE #568）。
 *
 * 背景（实测）：`src/lib/core/logger.ts` 曾是「零依赖自研日志器」——自己拼行、
 * 走 `console.log/error`、**零脱敏**；而 `src/server/lib/logger.ts` 是 pino
 * （`REDACT_PATHS` + 密钥值形状守卫 + ERROR 镜像进应用日志面板）。两条通道
 * 使用面都不小（core 由 `repository-base` / `events` / `container` 用，pino 由
 * 31 个文件用），后果是**同一件事两种口径**、且脱敏契约在其中一条上不成立。
 *
 * 现在 `core/logger` 只是 pino 的薄封装（接口给核心层、实现只有一份）。
 * 本用例把「不许再长出第二条实现」机器化：**除薄封装外，无人可以直接调
 * `console.*` 输出日志**。
 *
 * 为什么不用「检查 `core/logger` 里有没有 console」这一条就够：
 * 那只能挡住「回退到旧实现」，挡不住「下一个人在新模块里直接 `console.log`」——
 * 而那正是最初长出第二套实现的方式。判据落在**全 `src/`** 上才有意义。
 *
 * 豁免（都写了理由，且用**正向断言**锁住豁免文件本身没被改坏）：
 *   - `src/lib/core/logger.ts`     —— 薄封装本身（当前实现里已无 console 调用）
 *   - `src/server/lib/logger.ts`   —— pino 的镜像渲染（不直接调 console）
 *   - `src/lib/comfyui/trace.ts` 等诊断通道 —— 由各自的落盘契约约束，不走 console
 *   - `scripts/**`                 —— 纯 Node 宿主脚本，不走应用日志契约
 *
 * 允许的形态：`console` 出现在**测试**与**启动/浏览器侧**（`src/app/api` 之外的
 * 客户端代码本来就在浏览器控制台）。因此本用例只扫服务端可达的库代码。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * 扫描范围：**服务端可达的全部库代码**，无目录级豁免。
 *
 * 不扫视图层（`src/components/**`、`src/app/**`）—— 客户端本来就往浏览器
 * 控制台写，不在「服务端日志唯一通道」这条判据内。
 *
 * 历史上这里有 `SKIP_DIRS = ["src/lib/comfyui"]` 与一条 `ALLOWED`
 * （`generation-log.server.ts`），也就是**整片目录免检**。它们已被逐条消除：
 *
 *   - `generation-log.server.ts`：`console.warn` 已改走 `core/logger`（pino），
 *     消息文案不变，额外获得脱敏与 ERROR 镜像（面板可见）。豁免删除。
 *   - `src/lib/comfyui/**`：本目录**根本没有 console 调用**（实测），它真正的
 *     缺口是「trace 直写文件、不经脱敏」—— 那条由值形状守卫
 *     （`src/lib/core/redact-secret.ts`）在写入边界补上，不是靠目录免检绕开。
 *     目录级 SKIP 的危险恰在于：它让「以后往这里加 console」完全无声。
 */
const SCAN_DIRS = ["src/lib", "src/server"];

/** 去掉注释，避免把注释里提到的 `console.log` 误判成调用。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("日志实现只有一处（ISSUE #568）", () => {
  it("除日志门面外，服务端库代码里没有直接写 console 的日志实现", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split("\\").join("/");
        if (/\.test\.(ts|tsx)$/.test(rel)) continue; // 用例自己会打点/断言输出
        const src = stripComments(readFileSync(file, "utf8"));
        if (/\bconsole\s*\.\s*(log|info|warn|error|debug)\s*\(/.test(src)) {
          offenders.push(rel);
        }
      }
    }
    expect(
      offenders,
      "以下文件直接写 console —— 服务端日志必须走 pino 那一条通道\n" +
        "（`src/server/lib/logger.ts`，或核心层的薄封装 `src/lib/core/logger.ts`）：\n" +
        "直接 console 的后果是**绕开 redact 脱敏与 ERROR 镜像**（规范 07 §7.18.2.1）。",
    ).toEqual([]);
  });

  it("core/logger 是薄封装：委派给 pino，自己不再拼行", () => {
    const src = readFileSync(join(SRC, "lib", "core", "logger.ts"), "utf8");
    // 正向：确实 import 了服务端 pino 工厂（唯一实现处）
    expect(src).toMatch(/from\s+["']@\/server\/lib\/logger["']/);
    expect(src).toContain("createPinoLogger");
    // 反向：不再自带实现（旧实现的两个特征）
    expect(stripComments(src)).not.toMatch(/console\s*\./);
    expect(stripComments(src)).not.toMatch(/JSON\.stringify\(fields\)/);
  });

  it("脱敏契约在 core/logger 这条通道上也成立（不是只有 pino 自己那条）", () => {
    // 判据：core 门面必须由服务端 pino 工厂构造——脱敏/镜像的配置只在那边一份。
    const src = readFileSync(join(SRC, "lib", "core", "logger.ts"), "utf8");
    expect(src).not.toMatch(/process\.env\.LOG_LEVEL/);
    // 级别过滤也不许自己实现一遍（旧实现的特征）
    expect(src).not.toMatch(/LEVEL_ORDER/);
  });
  it("trace 直写通道也过值形状守卫（唯一脱敏实现的第二个消费者）", () => {
    // 判据：`comfyui/trace.ts` 直写文件、不经 pino —— 它必须自己调用共享守卫，
    // 否则「原始回执里的密钥明文落盘」这条在 §7.18.2.1 之后仍然成立。
    const src = readFileSync(join(SRC, "lib", "comfyui", "trace.ts"), "utf8");
    expect(src).toMatch(/from\s+["']@\/lib\/core\/redact-secret["']/);
    expect(stripComments(src)).toMatch(/redactSecretShaped\(/);
    // 反向：路径上不许再出现第二份守卫实现（PEM/JWT 判据各写一份 = 孪生对）
    expect(src).not.toMatch(/BEGIN \[A-Z \]\*PRIVATE KEY/);
  });

  it("值形状守卫只有一份实现（两条通道都从 core 取）", () => {
    const files = walk(join(SRC, "lib"))
      .concat(walk(join(SRC, "server")))
      .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) =>
        /export\s+function\s+redactSecretShaped/.test(readFileSync(f, "utf8")),
      )
      .map((f) => relative(ROOT, f).split("\\").join("/"));
    expect(files).toEqual(["src/lib/core/redact-secret.ts"]);
  });
});
