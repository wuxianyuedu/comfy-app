/**
 * 「应用服务为什么断了」的**跨侧同源**判据（ISSUE #1692）。写入侧（`scripts/*.mjs`）与读取侧（`src/lib/shell/app-service-exit.ts`）
 * 分居两个进程、两种语言，中间**没有编译器**只有一组字面量（文件名 / 字段名 / 成因取值）—— 任何一侧单独改名都是静默失效：
 * 记录照写、界面读不懂。故断言：① 文件名逐字相同；② TS 成因联合类型与写入侧实际取值集合完全一致；③ 字段真写进 JSON。Rust 侧（`shell_launch.rs`）同核这三者，读文本验。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { launcherChainSource } from "./helpers/launcher-source";
import { normalizeControlFlow } from "./helpers/source-shape";

const ROOT = process.cwd();
/* 形态断言只看控制流，不看括号：先过归一化，oxlint `curly` 补 `{}` 不改变判据结论
 * （`normalizeControlFlow` 对 `.rs` / `.ts` 之外的非 JS 家族原样返回，这里只包 JS 家族）。 */
const EXIT_MJS = normalizeControlFlow(
  readFileSync(join(ROOT, "scripts", "app-service-exit.mjs"), "utf8"),
  "app-service-exit.mjs",
);
/* 断的是**编排链路**（主文件 + 它顶层静态 import 的 `launcher-core/**`）而不是
 * 单份主文件：`concludeDownstreamExit` 随 R5 拆分搬进了
 * `launcher-core/downstream.mjs`，只读主文件时 `slice` 拿到空串、
 * `not.toContain` 则**静默恒真**（拆分的实现位置不是契约，契约是「收尾那一段
 * 里写不写记录」）。 */
const LAUNCHER_MJS = normalizeControlFlow(launcherChainSource(), "dev-launcher.mjs");
// 「收尾定性」这一族的判据不在入口文件里（§12.6 R5 的姊妹档盯着入口长度），
// 而在 launcher-core/downstream-exit.mjs。写入侧的成因取值要看**那个**函数体。
const DOWNSTREAM_EXIT_MJS = normalizeControlFlow(
  readFileSync(join(ROOT, "scripts", "launcher-core", "downstream-exit.mjs"), "utf8"),
  "downstream-exit.mjs",
);
const EXIT_TS = readFileSync(join(ROOT, "src", "lib", "shell", "app-service-exit.ts"), "utf8");
const SHELL_LAUNCH_RS = readFileSync(join(ROOT, "src-tauri", "src", "shell_launch.rs"), "utf8");
const SHELL_LIB_RS = readFileSync(join(ROOT, "src-tauri", "src", "lib.rs"), "utf8");

/** 从 TS 里抠出 `AppServiceExitKind` 的联合取值（写死的形态，改了这里就红）。 */
function tsKindUnion(): Array<string> {
  const block = /export type AppServiceExitKind =([\s\S]*?);/.exec(EXIT_TS)?.[1];
  if (block === undefined || block === "") {
    return [];
  }
  return [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
}

/**
 * 写入侧（JS）真会写出的成因集合。直接查 `kind:` 后的字面量不够：启动编排传的是 `kind` **变量**，取值来自
 * `downstreamExitKind` 的 return 字面量 —— 判据必须落在**那个函数体**上；只查传参处有没有字面量会让断言恒为空
 * （自测即如此、永远绿），运行期 `runtimeExitRecord` 写固定字面量 `dev-server` 也收进来（ISSUE #1692 第二半）。
 */
function writtenKinds(source: string): Array<string> {
  const fn = /export function downstreamExitKind\([\s\S]*?\n\}/.exec(source)?.[0];
  const body = fn ?? source;
  const fromTable = [...body.matchAll(/return\s+"([a-z-]+)"/g)].map((m) => m[1]!);
  const runtime = /export function runtimeExitRecord\([\s\S]*?\n\}/.exec(source)?.[0];
  const fromRuntime = [...(runtime ?? "").matchAll(/kind:\s*"([a-z-]+)"/g)].map((m) => m[1]!);
  return [...fromTable, ...fromRuntime];
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
    const launcherKinds = [...new Set(writtenKinds(DOWNSTREAM_EXIT_MJS))].sort();
    expect(launcherKinds.length).toBeGreaterThan(0);
    for (const kind of launcherKinds) {
      expect(ts).toContain(kind);
    }
  });

  it("写入侧落盘的字段名与 TS 的读取键同源", () => {
    for (const field of ["at", "kind", "code", "signal", "reason", "port", "runId"]) {
      expect(EXIT_MJS).toContain(field);
      expect(EXIT_TS).toContain(field);
    }
  });

  it("记录必须无 BOM（读取侧是 JSON.parse，BOM 会让它当场失败）", () => {
    // 两侧都写 utf8 且不写 BOM；TS 端点用的是 JSON.parse。
    expect(EXIT_MJS).toContain('"utf8"');
    expect(EXIT_MJS).not.toContain(String.raw`\uFEFF`);
  });

  it("启动编排在回收之前写下记录（写太晚 = 现场已经收走）", () => {
    // 判据 = 写入调用出现在收尾定性函数体内，且该函数以 shutdown 收尾。
    const at = LAUNCHER_MJS.indexOf("async function concludeDownstreamExit");
    expect(at, "编排链路上找不到 concludeDownstreamExit（拆分后别断了接线）").toBeGreaterThan(-1);
    const conclude = LAUNCHER_MJS.slice(at, at + 4000);
    expect(conclude).toContain("writeAppServiceExit(");
    /* 顺序：写记录必须排在**回收动作**之前。
     * 回收动作的记法随拆分变过一次（`shutdown(` → `ctx.shutdown(`）——
     * 认「`shutdown(` 这个调用名」而不是某一种前缀，否则下一次改签名又假红，
     * 而这条契约（先写后收）与调用方怎么称呼它无关。 */
    const shutdownAt = conclude.indexOf("shutdown(");
    expect(shutdownAt, "收尾那一段里找不到 shutdown 调用").toBeGreaterThan(-1);
    expect(conclude.indexOf("writeAppServiceExit(")).toBeLessThan(shutdownAt);
  });

  it("启动编排绝不「启动时清掉」这份记录（清掉就等于恢复后读不到）", () => {
    // 这是本设计的核心约束，误加一行 clear 会让整条链静默失效。
    expect(LAUNCHER_MJS).not.toContain("clearAppServiceExit");
  });

  it("**运行期**退出也走同一个写点，且在回收整树之前（ISSUE #1692 的第二半）", () => {
    /* 写侧此前只挂在 `concludeDownstreamExit`（就绪等待期）上，于是「服务起来之后
     * 自己没了」——用户在界面上真正会看到的「应用服务已断开」——一条记录都不写：
     * 恢复后读回 null，界面只能回一句把成因猜成「手工 pnpm dev」的兜底。 */
    expect(DOWNSTREAM_EXIT_MJS).toContain("export function runtimeExitRecord(");
    // 判据只认「dev 先退出」：壳先走是用户关窗 / 壳被收走，服务是被带走的。
    expect(DOWNSTREAM_EXIT_MJS).toContain('if (who !== "dev") return null;');
    // 调用点在常驻段，且排在 `await shutdown(` 之前（写太晚 = 现场已收走）。
    const resident = LAUNCHER_MJS.slice(LAUNCHER_MJS.indexOf("const record = runtimeExitRecord({"));
    expect(resident).toContain("writeAppServiceExit(ROOT, record)");
    expect(resident.indexOf("writeAppServiceExit(ROOT, record)")).toBeLessThan(
      resident.indexOf("await shutdown("),
    );
  });

  it("Rust 壳（sidecar 档）写的文件名与 Node 侧逐字相同", () => {
    // 第三处字面量：`src-tauri/src/shell_launch.rs` 的 `APP_SERVICE_EXIT_FILE`。
    // Rust 没有 import 那条路，只能各写一次——漂开的表现同样是「壳写的记录界面
    // 读不懂」，而这一档恰是用户唯一能看到的现场（窗口还在、页面全连不上）。
    const inRs = /APP_SERVICE_EXIT_FILE: &str = "([^"]+)"/.exec(SHELL_LAUNCH_RS)?.[1];
    const inTs = /APP_SERVICE_EXIT_FILE\s*=\s*"([^"]+)"/.exec(EXIT_TS)?.[1];
    expect(inRs).toBeTruthy();
    expect(inRs).toBe(inTs);
    expect(inRs).toBe("app-service-exit.json");
    // 落点必须与 launch-status.json 同在那个「服务不在也能读」的位置（run/）。
    expect(SHELL_LAUNCH_RS).toContain('.join("run")');
  });

  it("Rust 壳写的字段名与 TS 的读取键同源", () => {
    const writer = /pub fn write_sidecar_exit_record\([\s\S]*?\n\}/.exec(SHELL_LAUNCH_RS)?.[0];
    expect(writer).toBeTruthy();
    for (const field of ["at", "kind", "code", "signal", "reason", "port", "runId"]) {
      expect(writer).toContain(`"${field}"`);
    }
  });

  it("Rust 壳写的成因取值必须是 TS 认得出的那一个（sidecar 档）", () => {
    const writer = /pub fn write_sidecar_exit_record\([\s\S]*?\n\}/.exec(SHELL_LAUNCH_RS)?.[0];
    const kinds = [...(writer ?? "").matchAll(/"kind":\s*"([a-z-]+)"/g)].map((m) => m[1]!);
    expect(kinds).toEqual(["sidecar"]);
    // 且这个取值确实在 TS 的联合类型里（不是写一个界面认不出的档）。
    expect(tsKindUnion()).toContain("sidecar");
  });

  it("Rust 壳在 sidecar 终止事件里落盘，且拿不到退出码时写 null 不写 0", () => {
    // 顺序与位置是语义：Terminated 是唯一带着退出码的地方，记录必须在这一支里写
    // （排到别处就拿不到那一刻的事实）。
    const terminated = /CommandEvent::Terminated\(payload\) => \{[\s\S]*?\n\s{8}\}/.exec(
      SHELL_LIB_RS,
    )?.[0];
    expect(terminated).toBeTruthy();
    expect(terminated).toContain("write_sidecar_exit_record");
    // code 走 `Option<i32>` 原样透传：写侧对 None 落 null——「编不出 0」这条
    // 判据在 Rust 单测里（`sidecar_exit_record_never_invents_exit_code_zero`）。
    expect(SHELL_LIB_RS).toContain("payload.code");
    // 「拿不到就编一个 0」这条误改的判据收在**写侧函数体内**（文件别处有无关的
    // unwrap_or(0)，拿整份文件当判据只会误报）。
    const writer = /pub fn write_sidecar_exit_record\([\s\S]*?\n\}/.exec(SHELL_LAUNCH_RS)?.[0];
    expect(writer).toBeTruthy();
    expect(writer).not.toContain("unwrap_or(0)");
  });
});
