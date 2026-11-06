/** Turbopack「别追踪这条算出来的路径」注解的护栏（ISSUE #489）：`next build` 对无法静态收敛的路径访问会把
 * **整个项目**复制进 `.next/standalone` 并告警；注解必须落在**算出路径的表达式**上（`path.resolve/join`
 * 参数内、展开形式），塞进消费它的 `fs.*` 参数会被静默忽略（api/update-check、comfyui/status、
 * `server/workshop/db` 即「有注解却一直告警」）。用例另钉注解单一来源；改回旧写法或删展开即失败。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const IGNORE_MODULE = "src/lib/shell/tracing-ignore.ts";

/** 已知会因为动态路径访问触发「全项目追踪」的调用点。 */
const CONSUMERS = [
  "src/app/api/dev/build-id/route.ts",
  "src/app/api/update-check/route.ts",
  "src/lib/comfyui/status.ts",
  "src/lib/db-schema-ready.ts",
  "src/server/workshop/db.ts",
];

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("turbopackIgnore 注解的落位（TS 侧）", () => {
  it("注解只有一个来源，导出值就带着注解文本", () => {
    const src = read(IGNORE_MODULE);
    expect(src).toContain("export function tracingIgnoreArgs");
    expect(src).toContain("turbopackIgnore: true");
  });

  it.for(CONSUMERS)("%s 把注解展开进路径表达式（而不是塞在 fs 调用参数里）", (rel) => {
    const src = read(rel);
    // ① 引用共享模块（仓库里 ~/ 与 @/ 两个别名都指向 src/，两者都放行）
    expect(
      /from "(?:@|~)\/(?:lib\/)?(?:shell\/)?tracing-ignore"/.test(src),
      `${rel} 未引用共享的 tracing-ignore 模块（注解必须只有一个来源）`,
    ).toBe(true);
    // ② 展开进 path.resolve(...) / path.join(...) 的参数列表
    expect(
      /path\.(?:resolve|join)\(\s*\.\.\.tracingIgnoreArgs/.test(src),
      `${rel} 的 tracingIgnoreArgs 必须展开在 path.resolve/join 的参数列表里` +
        `（Turbopack 看的是算出路径的那个表达式，塞在 fs 调用参数里会被静默忽略）`,
    ).toBe(true);
  });

  it.for(CONSUMERS)("%s 没有沿用「塞在 fs 调用参数里」的失效写法", (rel) => {
    const src = read(rel);
    expect(
      /fs\.\w+\((?:\/\/)?[^\n]*turbopackIgnore/.test(src),
      `${rel} 仍把注解塞在 fs 调用的参数里 —— 该位置对 fs.* 一律无效（实测）`,
    ).toBe(false);
  });

  it("注解常量的使用点全部经共享模块（没有文件内再声明一份）", () => {
    for (const rel of CONSUMERS) {
      const src = read(rel);
      expect(
        /const\s+tracingIgnoreArgs\s*=/.test(src),
        `${rel} 自己声明了 tracingIgnoreArgs —— 注解必须只有一个来源，否则改一处漏五处`,
      ).toBe(false);
    }
  });

  it("注解模块保持纯 ASCII（它在构建期模块图上，会被 next-code-frame 渲染）", () => {
    const offenders = [...read(IGNORE_MODULE)].filter((ch) => ch.codePointAt(0)! > 0x7f);
    expect(
      offenders,
      `${IGNORE_MODULE} 含非 ASCII 字符：Next 的 code frame 按字节切串，切到多字节字符内部会让 ` +
        `构建以 Rust panic 收尾（end byte index N is not a char boundary）`,
    ).toEqual([]);
  });
});
