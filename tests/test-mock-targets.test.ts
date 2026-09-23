/**
 * 「死 mock」门禁：`vi.mock("<路径>")` 的说明符必须解析到**真实存在的模块**
 * （现场：2026-09-23 用户反馈「ComfyUI 莫名退出」）。
 *
 * 现场链条：`src/lib/comfyui/lifecycle.test.ts` 里写的是
 * `vi.mock("../log-paths", { SERVICES_LOG_DIR: "/tmp" })`，而真实模块是
 * `src/lib/log/log-paths.ts` —— 从该测试文件出发，`"../log-paths"` 解析到
 * `src/lib/log-paths`，**不存在**。`vi.mock` 对解析不到的路径**不报错**（工厂被
 * 注册在一个无人 import 的路径上），于是 mock 静默失效、真实模块照用：夹具会话
 * （`cmd: "python", baseArgs: ["-s", "/x/main.py"]`）被写进仓库真实的
 * `log/services/comfyui-runtime.log` 与 `comfyui-last-session.json`，那条记录
 * 「有开始、没结束」→ 下一次真机启动报「上一次 ComfyUI 会话（pid=未知）开始于 …，
 * 却没有退出记录」，用户读成「ComfyUI 莫名退出」（而它根本没被拉起过）。
 *
 * 这类缺陷的共同点：**测试全绿**，只有真实环境（下一次启动）才露出来，且露出的
 * 位置（启动日志）与出错位置（某个单测的 mock 说明符）隔着一整个进程 —— 因此把
 * 判据落在源码形态上：**可解析的 `vi.mock` / `vi.doMock` 说明符必须命中一个真实
 * 文件**（含 `.ts` / `.tsx` / 目录 `index` 等入口）。
 *
 * 只查本仓库内的说明符：相对路径（`.` 起）与 `~/`（→ `src/`）。裸包名
 * （`node:fs` / `vitest` / `child_process`）与 CSS 等非本仓模块不归本门禁管。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
/** 仓库内会写 `vi.mock` 的两处：应用源码与结构类测试。 */
const SCAN_ROOTS = ["src", "tests"];

/** bundler 会尝试的入口（够用的近似：显式后缀 + 目录 index）。 */
function candidates(withoutExt: string): string[] {
  return [
    withoutExt,
    `${withoutExt}.ts`,
    `${withoutExt}.tsx`,
    `${withoutExt}.js`,
    `${withoutExt}.mjs`,
    `${withoutExt}.cjs`,
    path.join(withoutExt, "index.ts"),
    path.join(withoutExt, "index.tsx"),
  ];
}

/**
 * 去掉注释后再扫描：本门禁自己的说明里也会出现 `vi.mock(…)` 的字面例子
 * （不加这一步，判据会把自己的文档当成一处死 mock）。`[^:]` 是为了不吞掉
 * `http://` 这类协议头。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 递归收集 `*.test.ts(x)`（跳过 node_modules 与点目录）。 */
function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...testFiles(full));
    else if (/\.test\.tsx?$/.test(item.name)) out.push(full);
  }
  return out;
}

describe("vi.mock 说明符必须解析到真实模块（死 mock 门禁）", () => {
  it("全仓可解析的 mock 目标都命中真实文件（失效的 mock 会静默退回真实 IO）", () => {
    const dead: string[] = [];
    let total = 0;

    for (const root of SCAN_ROOTS) {
      for (const file of testFiles(path.join(REPO_ROOT, root))) {
        const text = stripComments(fs.readFileSync(file, "utf8"));
        const re = /vi\.(?:mock|doMock)\(\s*["'`]([^"'`]+)["'`]/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          const specifier = match[1]!;
          if (!specifier.startsWith(".") && !specifier.startsWith("~/"))
            continue;
          total += 1;
          const base = specifier.startsWith("~/")
            ? path.join(REPO_ROOT, "src", specifier.slice(2))
            : path.resolve(path.dirname(file), specifier);
          if (!candidates(base).some((candidate) => fs.existsSync(candidate))) {
            dead.push(
              `${path.relative(REPO_ROOT, file)} → "${specifier}"（解析为 ${path.relative(REPO_ROOT, base)}，不存在）`,
            );
          }
        }
      }
    }

    /* 全仓至少有一批这类 mock：判据自己先证明「它真的在看东西」（扫描范围写错时
     * 不会变成一个永远为真的空断言）。 */
    expect(total).toBeGreaterThan(0);
    expect(
      dead,
      "以下 vi.mock 指向不存在的模块：mock 会静默失效、真实模块照用（往真实 log/ 写文件、真起进程就是它）",
    ).toEqual([]);
  });
});
