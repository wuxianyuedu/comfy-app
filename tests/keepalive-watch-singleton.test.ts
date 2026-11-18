/**
 * 保活退出监督器的跨 HMR 单例形态（#4230）：`keepAliveExitWatcher` 原是模块级
 * 变量——dev 热重载后旧模块的监督器 interval 还活着、新实例看到 null 再挂一个
 * ⇒ 双监督器并存、退出横幅可能双发（同文件其它跨 HMR 单例都挂 globalThis，
 * 唯独这个漏了）。钉两件事：单例挂在**带版本号**的 globalThis 键上；模块里
 * 不再残留模块级裸变量（那等于双轨）。没有运行期入口，钉源码形态。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "lib", "comfyui", "lifecycle-launch.ts"),
  "utf8",
);

describe("保活退出监督器的跨 HMR 单例（#4230）", () => {
  it("监督器挂在带版本号的 globalThis 键上（HMR 重载后仍是同一份）", () => {
    expect(src).toMatch(/var __comfyKeepAliveWatch_v1/);
    expect(src).toContain("globalThis.__comfyKeepAliveWatch_v1");
  });

  it("不再有模块级裸变量双轨（旧形态换名重写 = 第二份状态）", () => {
    expect(src).not.toMatch(/let keepAliveExitWatcher/);
  });
});
