/**
 * ISSUE #1959：CPU 档位必须在**两条**拉起路径（bound / keepAlive）上都真被施加。跑一遍不可行——都要真起
 * ComfyUI，而安装是用户自备件（用例不能假装它存在）；失效又静默：少一处调用，设置页照旧可选、日志照旧写着
 * 「已让路」，只有任务管理器知道没生效。故判源码形状，匹配前先 `./helpers/strip-comments` 剥注释。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(__dirname, "..");

function launchSource(): string {
  return stripComments(
    readFileSync(path.join(ROOT, "src/lib/comfyui/lifecycle-launch.ts"), "utf8"),
  ).replaceAll("\r\n", "\n");
}

describe("CPU 档位必须接进两条拉起路径（ISSUE #1959）", () => {
  it("bound 路径：起进程后带着**自己的 PID** 施加（句柄就在手上）", () => {
    const src = launchSource();
    /* 判据是「applyCpuLimitAsync 的调用里有 child.pid」而不是数调用次数 ——
     * 后者对着注释里的说明也成立（虽然注释已被剥掉，仍不该退化成计数）。 */
    expect(src).toMatch(/applyCpuLimitAsync\(\s*\{[^}]*pid:\s*child\.pid/);
  });

  it("keepAlive 路径：按 main.py 反查 PID 再施加（那条路径拿不到子进程句柄）", () => {
    const src = launchSource();
    /* 这条路径的坑：`spawnManaged` 的 keepAlive 分支在 Windows 上是
     * Start-Process 的孙进程、POSIX 上已 unref —— `child.pid` 不可信。
     * 所以必须有一条按 main.py 反查的路径。 */
    expect(src).toContain("resolveAndApplyCpuLimitForKeepAlive");
    expect(src).toMatch(/findPidForMainPyDetailed/);
  });

  it("反查是**有界**的：查不到要收手并如实说一句，不许变成永不收手的后台循环", () => {
    const src = launchSource();
    expect(src).toMatch(/KEEPALIVE_CPU_PID_ATTEMPTS\s*=\s*\d+/);
    /* 用尽后的那句必须存在 —— 没有它，用户在「解释器根本起不来」时会以为
     * 这一档生效了（硬规则 4：失败路径要有用户可见出口）。 */
    expect(src).toContain("CPU 档位未能施加");
  });

  it("档位在**拉起前解析一次**、两条路径共用 —— 不许在两条路径里各判一遍", () => {
    const src = launchSource();
    expect(src).toContain("resolveCpuLimitMode(");
    /* ctx 里带一份：两条 launch 函数读同一个字段。 */
    expect(src).toMatch(/cpuLimitMode:\s*CpuLimitMode/);
    expect(src).toMatch(/mode:\s*ctx\.cpuLimitMode/);
  });
});
