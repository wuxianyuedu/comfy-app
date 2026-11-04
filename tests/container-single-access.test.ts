/**
 * 回归护栏：**仓储只有一种取用法**（ISSUE #568）。曾并存 `container.resolve("projectRepository")`（12 处）与直接 import（29 个文件），`container.ts`
 * 的注释却承诺「只通过 container 取用」—— 现状恰好相反。裁决：**移除容器、统一直接 import**；`src/` 里不许再出现 `container.resolve(` /
 * `lib/core/container`，新增取用走 `@/lib/core/repository`。两个前提（任一被推翻就该重裁）：① 两者取到同一对象（工厂返回模块单例，`register(..., mock)` 从未被用）；② 直接 import 是多数派且是全仓既有形态。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: Array<string> = []): Array<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("仓储取用只有一个入口（ISSUE #568）", () => {
  // 整树 walk + readFileSync 的判据：开发机并行跑多份工程时，5s 默认超时会因
  // CPU 争用假红（单独跑 <3s）。给足容忍度，断言本身不变。
  it("src/ 下没有任何 container 取用或引用", { timeout: 30_000 }, () => {
    const offenders: Array<string> = [];
    for (const file of walk(SRC)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      /* 判据只认代码：注释里说明「为什么没有容器」是允许的。用唯一实现 `./helpers/strip-comments`
       * （默认档 = 块注释 + 整行注释）：旧形那条**不跟引号状态**的块注释正则会从 `accept: "image/*"` 一路吃到
       * 下一个「星号紧跟斜杠」—— 实测 src/** 里 23 份文件、199 行就这么消失（ISSUE #2969）；
       * 旧的第二跳剔「以星号开头的行」是给没剥干净的续行兜底，helper 整段剥掉，不需要这一条。 */
      const code = stripComments(readFileSync(file, "utf8"));
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
