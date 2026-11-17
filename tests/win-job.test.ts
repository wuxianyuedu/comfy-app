/**
 * 回归护栏：Windows Job Object（KILL_ON_JOB_CLOSE）防孤儿，实现在壳内联（#784：壳被硬杀时其拉起的整棵树残留，故 OS 兜底靠壳持有 job 句柄 —— 壳死即终止全树）。
 * 旧 `scripts/win_job.py` 的「句柄复制进编排器」模型兜不住「壳死 node 活」，且 CLI 空跑 exit 0 会短路正确实现，已删除；内联是唯一出处。
 * 钉死（静态，Rust 不在 vitest 跑，同 shell-self-launch.test.ts）：shell_launch.rs 内联完整实现、句柄存 JOB_HANDLE / SIDECAR_JOB_HANDLE（#4165 起 sidecar 那棵树同享）不 CloseHandle、无 win_job.py / attach_job_via_helper 路径。
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

  it("句柄由壳持有（存进 JOB_HANDLE / SIDECAR_JOB_HANDLE、故意不关）", () => {
    const src = read(SHELL_LAUNCH);
    expect(src).toContain("static JOB_HANDLE");
    expect(src).toContain("static SIDECAR_JOB_HANDLE");
    // 共同内核返回句柄值，两棵树（编排器 / standalone sidecar，#4165）各存各的 static。
    expect(src).toContain("*JOB_HANDLE.lock().unwrap() = job;");
    expect(src).toContain("*SIDECAR_JOB_HANDLE.lock().unwrap() = job;");
  });

  it("外部脚本路径已移除：win_job.py 删除、无 attach_job_via_helper（内联是唯一实现）", () => {
    const src = read(SHELL_LAUNCH);
    expect(src).not.toContain("win_job.py");
    expect(src).not.toContain("attach_job_via_helper");
    expect(fs.existsSync(path.join(ROOT, "scripts", "win_job.py"))).toBe(false);
  });
});
