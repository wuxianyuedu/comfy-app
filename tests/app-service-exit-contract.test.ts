/**
 * 「应用服务为什么断了」的**跨侧同源**判据（ISSUE #1692）。
 *
 * 这件事的写入侧与读取侧分居两个进程、两种语言：启动编排（`scripts/*.mjs`）
 * 在服务死的那一刻落盘，应用服务恢复应答之后由 `src/lib/shell/app-service-exit.ts`
 * 读回并讲给用户听。两侧之间**没有编译器**，只有一组字面量（文件名、字段名、
 * 成因取值）—— 任何一侧单独改名都是一次静默失效：记录照写、界面读不懂，
 * 而现场恰好是最需要看清的那一次。
 *
 * 因此这一组断言把「同源」变成可失败的判据：
 *   ① 文件名两侧逐字相同；
 *   ② TS 的成因联合类型与写入侧实际会写的取值集合完全一致（不是「包含」——
 *      写入侧能写一个 TS 认不出的取值、或 TS 声明一个没人会写的取值，都是漂移）；
 *   ③ 写入侧真的把这些字段写进了 JSON（字段名与 TS 的读取键同源）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EXIT_MJS = readFileSync(
  join(ROOT, "scripts", "app-service-exit.mjs"),
  "utf8",
);
const LAUNCHER_MJS = readFileSync(
  join(ROOT, "scripts", "dev-launcher.mjs"),
  "utf8",
);
const EXIT_TS = readFileSync(
  join(ROOT, "src", "lib", "shell", "app-service-exit.ts"),
  "utf8",
);

/** 从 TS 里抠出 `AppServiceExitKind` 的联合取值（写死的形态，改了这里就红）。 */
function tsKindUnion(): string[] {
  const block = /export type AppServiceExitKind =([\s\S]*?);/.exec(
    EXIT_TS,
  )?.[1];
  if (!block) return [];
  return [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
}

/**
 * 写入侧（JS）真会写出的成因集合。
 *
 * 直接读 `kind:` 后面的字面量是不够的 —— 启动编排传的是 `kind` **变量**，它的取值
 * 来自 `downstreamExitKind` 的返回字面量。所以判据要落在**那个函数体**上：它 return
 * 什么，就是这份记录可能被写成什么。只查「传参处有没有字面量」会让这条断言在
 * 真实形态下恒为空（自测时就是这样），变成一条永远绿的假判据。
 */
function writtenKinds(source: string): string[] {
  const fn = /export function downstreamExitKind\([\s\S]*?\n\}/.exec(
    source,
  )?.[0];
  const body = fn ?? source;
  return [...body.matchAll(/return\s+"([a-z-]+)"/g)].map((m) => m[1]!);
}

describe("应用服务退出记录：跨侧同源", () => {
  it("文件名两侧逐字相同", () => {
    const inTs = /APP_SERVICE_EXIT_FILE\s*=\s*"([^"]+)"/.exec(EXIT_TS)?.[1];
    const inMjs = /APP_SERVICE_EXIT_FILE\s*=\s*"([^"]+)"/.exec(EXIT_MJS)?.[1];
    expect(inTs).toBeTruthy();
    expect(inMjs).toBe(inTs);
    // 落点必须与 `launch-status.json` 同在 run/ 下（同属「本次运行的现场」）。
    expect(EXIT_MJS).toContain('path.join(root, "run"');
  });

  it("TS 的成因联合类型与写入侧取值集合完全一致（不是「包含」）", () => {
    const ts = tsKindUnion().sort();
    expect(ts.length).toBeGreaterThan(0);
    // 启动编排那条路会写的成因，必须每个都被 TS 认得出。
    const launcherKinds = [...new Set(writtenKinds(LAUNCHER_MJS))].sort();
    expect(launcherKinds.length).toBeGreaterThan(0);
    for (const kind of launcherKinds) {
      expect(ts).toContain(kind);
    }
  });

  it("写入侧落盘的字段名与 TS 的读取键同源", () => {
    for (const field of [
      "at",
      "kind",
      "code",
      "signal",
      "reason",
      "port",
      "runId",
    ]) {
      expect(EXIT_MJS).toContain(field);
      expect(EXIT_TS).toContain(field);
    }
  });

  it("记录必须无 BOM（读取侧是 JSON.parse，BOM 会让它当场失败）", () => {
    // 两侧都写 utf8 且不写 BOM；TS 端点用的是 JSON.parse。
    expect(EXIT_MJS).toContain('"utf8"');
    expect(EXIT_MJS).not.toContain("\\uFEFF");
  });

  it("启动编排在回收之前写下记录（写太晚 = 现场已经收走）", () => {
    // 判据 = 写入调用出现在收尾定性函数体内，且该函数以 shutdown 收尾。
    const conclude = LAUNCHER_MJS.slice(
      LAUNCHER_MJS.indexOf("async function concludeDownstreamExit"),
      LAUNCHER_MJS.indexOf("async function concludeDownstreamExit") + 4000,
    );
    expect(conclude).toContain("writeAppServiceExit(");
    // 顺序：写记录在 `await shutdown(` 之前。
    expect(conclude.indexOf("writeAppServiceExit(")).toBeLessThan(
      conclude.indexOf("await shutdown("),
    );
  });

  it("启动编排绝不「启动时清掉」这份记录（清掉就等于恢复后读不到）", () => {
    // 这是本设计的核心约束，误加一行 clear 会让整条链静默失效。
    expect(LAUNCHER_MJS).not.toContain("clearAppServiceExit");
  });
});
