/**
 * 回归护栏：**日志实现只有一处**（ISSUE #568）。`core/logger.ts` 曾是零依赖自研器（自拼行、`console.*`、
 * 零脱敏），`server/lib/logger.ts` 是 pino（REDACT + 镜像）—— 同一件事两种口径、脱敏在一条上不成立。
 * 现 `core/logger` 是唯一实现；本用例钉「除门面外无人可直调 `console.*`」，且判据落在全 `src/` 服务端码。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * 扫描范围：**服务端可达的全部库代码**，无目录级豁免；不扫视图层（客户端本就往浏览器控制台写）。
 * 历史 `SKIP_DIRS`（`src/lib/comfyui`）与 `ALLOWED`（`generation-log.server.ts`）已逐条消除：前者本就
 * 无 console（缺口由 `redact-secret.ts` 在写入边界补上）。目录级 SKIP 的危险恰在「以后加 console 完全无声」。
 */
const SCAN_DIRS = ["src/lib", "src/server"];

/** 去掉注释，避免把注释里提到的 `console.log` 误判成调用。 */
function stripComments(src: string): string {
  return src.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * 浏览器侧唯一通道的豁免清单，须**全部**三条成立：① 首行 `"use client"`（只进浏览器包、服务端不可达）；
 * ② console 是诊断的**传输手段本身**（`LogProvider` 拦进面板，规范 07 §7.6）且同诊断还走 `h.onLog`；
 * ③ 按**文件**点名，豁免由末尾正向断言锁住。`sync-notice.ts` 不能用 pino 门面（会点着 node-builtins）。
 */
const CLIENT_ONLY = [
  "src/lib/workshop/generation-client.ts",
  "src/lib/project-canvas/sync-notice.ts",
];

function walk(dir: string, out: Array<string> = []): Array<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(?:ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("日志实现只有一处（ISSUE #568）", () => {
  it("除日志门面外，服务端库代码里没有直接写 console 的日志实现", () => {
    const offenders: Array<string> = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split("\\").join("/");
        if (/\.test\.(?:ts|tsx)$/.test(rel)) {
          continue;
        } // 用例自己会打点/断言输出
        if (CLIENT_ONLY.includes(rel)) {
          continue;
        } // 浏览器侧唯一通道，见上方清单
        const src = stripComments(readFileSync(file, "utf8"));
        if (/\bconsole\s*\.\s*(?:log|info|warn|error|debug)\s*\(/.test(src)) {
          offenders.push(rel);
        }
      }
    }
    expect(
      offenders,
      "以下文件直接写 console —— 服务端日志必须走那一条通道\n" +
        "（实现只有一份：`src/lib/core/logger.ts`；服务端可取 `src/server/lib/logger.ts` 的中转）：\n" +
        "直接 console 的后果是**绕开 redact 脱敏与 ERROR 镜像**（规范 07 §7.18.2.1）。",
    ).toEqual([]);
  });

  it("浏览器侧豁免确实标了 use client，且 console 真在用它", () => {
    // 正向后置断言：豁免不许套在服务端可达的文件上。首行必须是 `"use client"`
    // （只进浏览器图、永不上服务端），且文件里确实有 console 调用 —— 否则
    // 这条豁免就是白挂的，应当从清单里删掉。
    for (const rel of CLIENT_ONLY) {
      const raw = readFileSync(join(ROOT, rel), "utf8");
      expect(raw.split("\n")[0]?.trim(), `${rel} 首行必须是 "use client"`).toBe('"use client";');
      expect(stripComments(raw), `${rel} 里应当有 console 调用`).toMatch(
        /\bconsole\s*\.\s*(?:log|info|warn|error|debug)\s*\(/,
      );
    }
  });

  it("core/logger 是唯一实现：日志配置全在这里，且不再自研拼行", () => {
    const src = readFileSync(join(SRC, "lib", "core", "logger.ts"), "utf8");
    // 正向：实现（pino 工厂 + 脱敏路径 + 镜像）确实在本文件里
    expect(src).toContain("createPinoLogger");
    expect(src).toContain("REDACT_PATHS");
    expect(src).toMatch(/from\s+["']pino["']/);
    // 反向：不再自带实现（旧实现的两个特征）
    expect(stripComments(src)).not.toMatch(/console\s*\./);
    expect(stripComments(src)).not.toMatch(/JSON\.stringify\(fields\)/);
  });

  it("服务端出口是转发层，不再自带第二份实现", () => {
    const src = readFileSync(join(SRC, "server", "lib", "logger.ts"), "utf8");
    // 正向：确实从地基侧取实现
    expect(src).toMatch(/from\s+["']~\/lib\/core\/logger["']/);
    // 反向：pino 的构造与脱敏路径不许在本文件里再来一份
    expect(src).not.toMatch(/from\s+["']pino["']/);
    expect(src).not.toMatch(/createPinoLogger\s*\(/);
    expect(src).not.toContain("REDACT_PATHS =");
    expect(stripComments(src)).not.toMatch(/console\s*\./);
  });

  it("日志实现只有一处：pino 工厂与 ERROR 镜像不许在别处重建", () => {
    // 判据落在「实现特征」上，而不是文件清单：谁在 import pino / 谁在定义 redact 路径，
    // 谁就是实现处。两份实现只要出现，这条立刻红。
    const implementors = [...walk(join(SRC, "lib")), ...walk(join(SRC, "server"))]
      .filter((f) => !/\.test\.(?:ts|tsx)$/.test(f))
      .filter((f) => /from\s+["']pino["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).split("\\").join("/"));
    expect(
      implementors,
      "日志实现只允许在 src/lib/core/logger.ts 一份 —— 另一处 import pino 就是第二条通道。",
    ).toEqual(["src/lib/core/logger.ts"]);
  });
  it("trace 直写通道也过值形状守卫（唯一脱敏实现的第二个消费者）", () => {
    // 判据：`comfyui/trace.ts` 直写文件、不经 pino —— 它必须自己调用共享守卫，
    // 否则「原始回执里的密钥明文落盘」这条在 §7.18.2.1 之后仍然成立。
    const src = readFileSync(join(SRC, "lib", "comfyui", "trace.ts"), "utf8");
    expect(src).toMatch(/from\s+["']~\/lib\/core\/redact-secret["']/);
    expect(stripComments(src)).toMatch(/redactSecretShaped\(/);
    // 反向：路径上不许再出现第二份守卫实现（PEM/JWT 判据各写一份 = 孪生对）
    expect(src).not.toMatch(/BEGIN \[A-Z \]\*PRIVATE KEY/);
  });

  it("值形状守卫只有一份实现（两条通道都从 core 取）", () => {
    const files = [...walk(join(SRC, "lib")), ...walk(join(SRC, "server"))]
      .filter((f) => !/\.test\.(?:ts|tsx)$/.test(f))
      .filter((f) => /export\s+function\s+redactSecretShaped/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).split("\\").join("/"));
    expect(files).toEqual(["src/lib/core/redact-secret.ts"]);
  });
});
