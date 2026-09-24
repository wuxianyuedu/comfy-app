/**
 * 回归护栏：**仓储只有一种取用法**（ISSUE #568）。
 *
 * 背景（实测）：仓库里曾并存两条取用仓储的路 ——
 *   · `container.resolve("projectRepository")`（2 个 router / 10 处调用）
 *   · `import { taskRepository } from "@/lib/core/repository"`（29 个文件）
 * 而 `container.ts` 的注释承诺「业务代码只通过 container 取用，不直接 new、
 * 不直接 import 具体单例」——**它的现状与承诺恰好相反**，容器是少数派。
 *
 * 裁决（ISSUE #568）：**移除容器，统一直接 import**。判据不是「哪个注释更像
 * 架构」，而是下面显式写出的那两条；换句话说，做这个决定不需要引入任何新抽象。
 *
 * 本用例把裁决的两个前提钉住（任一条被推翻，就该重新裁决，而不是让它悄悄漂移）：
 *
 *   ① **容器与直接 import 取到的是同一个对象**：`container.register("x", () => x)`
 *      的工厂返回的就是模块单例本身，没有「每个 resolve 一个新实例」的语义 ——
 *      所谓「可替换单例」在本仓库从未被用（没有任何一处 `register(..., mock)`）。
 *   ② **直接 import 是多数派且是全仓既有形态**：仓储模块 `import "server-only"`，
 *      本身就是进程级单例（`export const xRepository = new XRepository()`）。
 *
 * 反向断言（防止「改回来」）：`src/` 里不许再出现 `container.resolve(` /
 * `lib/core/container`。新增取用一律走 `@/lib/core/repository`。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

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

describe("仓储取用只有一个入口（ISSUE #568）", () => {
  // 整树 walk + readFileSync 的判据：开发机并行跑多份工程时，5s 默认超时会因
  // CPU 争用假红（单独跑 <3s）。给足容忍度，断言本身不变。
  it("src/ 下没有任何 container 取用或引用", { timeout: 30_000 }, () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      // 注释里说明「为什么没有容器」是允许的（判据只认代码）：整块注释先剥掉。
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const code = src
        .split("\n")
        .filter((line) => !/^[ \t]*(\/\/|\*)/.test(line))
        .join("\n");
      if (
        /(^|[^\w.])container\.resolve\s*\(/.test(code) ||
        /from\s+["'][^"']*core\/container["']/.test(code)
      ) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      "以下文件仍在使用已被移除的 DI 容器。仓储取用统一走\n" +
        '`import { <x>Repository } from "@/lib/core/repository"` ——\n' +
        "它与容器取到的是同一个单例，但只有这一条路是全仓的既成事实（ISSUE #568）。",
    ).toEqual([]);
  });

  it("container.ts 已删除，barrel 不再导出它", () => {
    const barrel = readFileSync(join(SRC, "lib", "core", "index.ts"), "utf8");
    expect(barrel).not.toMatch(/export\s+\*\s+from\s+["']\.\/container["']/);
    // 说明文字要在：下一个人得知道「这里为什么没有容器」，否则会再加回来。
    expect(barrel).toContain("为什么没有 container");
  });
});
