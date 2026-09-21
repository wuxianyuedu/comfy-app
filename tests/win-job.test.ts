/**
 * 回归护栏：Windows Job Object（KILL_ON_JOB_CLOSE）防孤儿 —— 实现在壳内联。
 *
 * 背景：#784 把启动器从 python 移进壳自己（进程树 = 壳 app.exe → node 编排器 →
 * pnpm → next，壳是顶）。壳被硬杀时它拉起的整棵树会残留成孤儿；OS 级兜底是壳建一个
 * `KILL_ON_JOB_CLOSE` 的 job、把编排器纳入、**句柄由壳持有**（壳死 → 最后一个句柄
 * 关闭 → OS 当场终止整棵树）。
 *
 * 曾用 `scripts/win_job.py`（Python/ctypes）经命令行挂载，但其「句柄复制进编排器」
 * 模型在 #784 下兜不住「壳被硬杀、node 还活着」（node 持句柄 → job 不关）；且它的
 * CLI 只认 --selftest、`python win_job.py <pid>` 空跑 exit 0，会把下面那份正确的内联
 * 实现短路掉（Better Harness 第二轮评审抓出）。已删除 win_job.py，内联是唯一出处。
 *
 * 钉死（静态；Rust 无法在 vitest 里跑，与 shell-self-launch.test.ts 同口径）：
 *   1. shell_launch.rs 有完整内联实现（CreateJobObjectW、SetInformationJobObject、
 *      AssignProcessToJobObject、JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE、
 *      JobObjectExtendedLimitInformation）；
 *   2. 句柄由壳持有（存进 JOB_HANDLE、故意不 CloseHandle）；
 *   3. 不再有 win_job.py / attach_job_via_helper 外部脚本路径（单一实现）；
 *   4. scripts/win_job.py 已删除。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SHELL_LAUNCH = path.join(ROOT, "src-tauri", "src", "shell_launch.rs");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("Job Object 防孤儿（壳内联实现，唯一出处）", () => {
  it("shell_launch.rs 有完整的内联 KILL_ON_JOB_CLOSE 实现", () => {
    const src = read(SHELL_LAUNCH);
    for (const api of [
      "CreateJobObjectW",
      "SetInformationJobObject",
      "AssignProcessToJobObject",
      "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
      "JobObjectExtendedLimitInformation",
    ]) {
      expect(src).toContain(api);
    }
  });

  it("句柄由壳持有（存进 JOB_HANDLE、故意不关）", () => {
    const src = read(SHELL_LAUNCH);
    expect(src).toContain("static JOB_HANDLE");
    expect(src).toContain("*JOB_HANDLE.lock().unwrap() = job.0 as usize");
  });

  it("外部脚本路径已移除：win_job.py 删除、无 attach_job_via_helper（内联是唯一实现）", () => {
    const src = read(SHELL_LAUNCH);
    expect(src).not.toContain("win_job.py");
    expect(src).not.toContain("attach_job_via_helper");
    expect(fs.existsSync(path.join(ROOT, "scripts", "win_job.py"))).toBe(false);
  });
});
