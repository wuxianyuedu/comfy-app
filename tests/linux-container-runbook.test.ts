/**
 * 「宿主是 Linux 容器」这份跑法清单（launch-and-build §10）与源码不许各说一套。
 *
 * 为什么需要这份判据：§10 写的每一条都是**会静默失效**的那种事实 ——
 *   · 「`pnpm dev` 不带 `-H`、`pnpm start` 硬钉 `127.0.0.1`」：说反了，用户会在
 *     容器里绑错地址，然后从宿主连不上、而容器日志一切正常；
 *   · 「端口按检出路径推导」：写成「固定 3100」的话，宿主映射的端口与容器里监听的
 *     端口是两个数字，现场是 ERR_CONNECTION_REFUSED；
 *   · 「`allowedDevOrigins` 只放两个回环名」：写成「放开了跨源」会让人以为从宿主 IP
 *     访问是受支持的。
 *
 * 三句话的权威源分别是 `scripts/dev.mjs` / `scripts/start.mjs` / `next.config.js`，
 * 所以这里**读源码复算清单里的断言**，而不是读一遍文档再读一遍文档。
 *
 * ⚠️ 这份用例**不判**「容器里跑得快不快」那类结论（它们没有机器判据，只能由读数说话），
 * 也**不判** `.cnb.yml` 的形态（那是 `tests/no-platform-ci-config.test.ts` 的事）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (rel: string): string =>
  readFileSync(path.join(root, rel), "utf8");

const doc = read("docs/standards/launch-and-build.md");
const dev = read("scripts/dev.mjs");
const start = read("scripts/start.mjs");
const standaloneEnv = read("scripts/launcher-core/standalone-runtime-env.mjs");
const nextConfig = read("next.config.js");

/** 取出 §10 那一章的正文（到下一个 `## ` 标题为止）。 */
function chapter(): string {
  const begin = doc.indexOf("\n## 10. ");
  expect(begin, "launch-and-build.md 少了第 10 章").toBeGreaterThan(-1);
  const rest = doc.slice(begin + 1);
  const end = rest.indexOf("\n## ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("§10「宿主是 Linux 容器」的清单与源码同源", () => {
  it("dev 链路确实**不**硬钉监听地址（否则「容器里绑 0.0.0.0」那句话是错的）", () => {
    // 形如 `if (hostname) nextArgs.push("-H", hostname)` —— 只在显式给定时才传。
    expect(dev).toMatch(/if \(hostname\) nextArgs\.push\("-H", hostname\)/);
    const chapterText = chapter();
    expect(chapterText).toContain("pnpm dev");
    expect(chapterText).toContain("-H");
  });

  it("start 链路确实硬钉回环（容器里从宿主访问不到，这是 §10.3 的第一行）", () => {
    // `start.mjs` 本身不给 `-H`；回环是**运行期环境**那一侧钉的（NEXT 读 HOSTNAME）。
    expect(standaloneEnv).toMatch(/HOSTNAME: LOOPBACK_HOST/);
    expect(start).toContain("next");
    expect(chapter()).toContain("127.0.0.1");
  });

  it("端口是**推导**出来的，清单里不许把它写成固定值", () => {
    expect(chapter()).toContain("derivePortFromPath");
    // 兜底值与推导区间归 `scripts/app-port.mjs`（文档里只写语义，不抄数字）。
    expect(read("scripts/app-port.mjs")).toContain("DERIVED_PORT_BASE");
  });

  it("`allowedDevOrigins` 只放两个回环名 —— 清单不许暗示「跨源也放开了」", () => {
    const entry = /allowedDevOrigins:\s*\[([\s\S]*?)\]/.exec(nextConfig)?.[1];
    expect(entry).toBeTruthy();
    const hosts = [...(entry ?? "").matchAll(/["']([^"']+)["']/g)]
      .map((m) => m[1])
      .sort();
    expect(hosts).toEqual(["127.0.0.1", "localhost"]);
    expect(chapter()).toContain("allowedDevOrigins");
  });

  it("回环闸门那一条指向唯一实现，不在文档里另立判据", () => {
    expect(read("src/lib/console/console-guard.ts")).toContain(
      "isLoopbackRequest",
    );
    expect(chapter()).toContain("console-guard.ts");
  });

  it("四条自测命令都是**真实存在**的入口（写一条跑不了的命令 = 一张过期的清单）", () => {
    const chapterText = chapter();
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    for (const script of ["check:toolchain", "env:init", "db:push"]) {
      expect(scripts[script], `package.json 少了 ${script}`).toBeDefined();
      expect(chapterText).toContain(`pnpm ${script}`);
    }
    for (const file of [
      "scripts/dev.mjs",
      "scripts/env-init.mjs",
      "scripts/db-push.mjs",
    ]) {
      expect(() => read(file), `${file} 不在盘上`).not.toThrow();
      expect(chapterText).toContain(file);
    }
  });

  it("本章不复述 §9 / §13.5.3 —— 三处各写一遍就是三个会漂的版本", () => {
    const chapterText = chapter();
    // 允许「指向」，不允许「重抄」（重抄的标志是再写一遍完整的操作步骤表）。
    expect(chapterText).toContain("§9");
    expect(chapterText).toContain("§13.5.3");
    expect(chapterText).not.toMatch(/setup-comfy-cli-venv\.ps1/);
  });
});
