/**
 * 分发产物卫生护栏（ISSUE #489）
 * ===========================================================================
 *
 * 背景：`next build` 会把仓库根的 `.env` 与 `db.sqlite` 一起复制进
 * `.next/standalone` —— 前者是 Next standalone 的环境加载行为（实测
 * `outputFileTracingExcludes` 写 `./.env` 也删不掉），后者是动态路径 tracing。
 * 两者随 `scripts/build-desktop.mjs` 组装的 `src-tauri/static` 被**编译期内嵌
 * 进 exe**，后果不是「多带了个文件」：
 *   1) `.env` 里的 `BETTER_AUTH_SECRET` / OAuth client secret 明文随包分发；
 *   2) 壳以 `current_dir(res_dir)` 启动 sidecar，而 `resolveDbPath` 按
 *      `process.cwd()` 解析 `db.sqlite` —— 被带进包的开发库就是应用首次启动时
 *      读写的那个库，开发者本机数据变成出厂数据。
 *
 * CI 不跑 `build-desktop`（也不该跑），所以这条口子只能靠「清单 + 产物层检查」
 * 两道守：本用例锁清单还在（改坏了先红），`check-standalone-contents.cjs`
 * 在构建后真去数文件（清单还在 ≠ 清单生效）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buildDesktop = readFileSync(
  join(process.cwd(), "scripts", "build-desktop.mjs"),
  "utf8",
);
const stripModule = readFileSync(
  join(process.cwd(), "scripts", "standalone-private-inputs.mjs"),
  "utf8",
);
const checker = readFileSync(
  join(process.cwd(), "scripts", "check-standalone-contents.cjs"),
  "utf8",
);
const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("开发机私有输入的剔除清单（单一实现，两处复用）", () => {
  it("清单覆盖 .env 家族与 db.sqlite*（含 WAL/SHM 边车文件）", () => {
    // 断言的是「清单里逐个列了这些名字」，不是「有这个变量名」——
    // 变量在而条目被删同样会让密钥随包走。
    for (const name of [
      '".env"',
      '".env.local"',
      '".env.production"',
      '"db.sqlite"',
      '"db.sqlite-wal"',
      '"db.sqlite-shm"',
    ]) {
      expect(stripModule, `剔除清单缺少 ${name}`).toContain(name);
    }
  });

  it("build-desktop 复用同一份实现（不在自己文件里另写一套清单）", () => {
    expect(buildDesktop).toContain(
      'import { stripPrivateInputs } from "./standalone-private-inputs.mjs"',
    );
    expect(buildDesktop).toMatch(/stripPrivateInputs\(staticDir,/);
    // 反例：static 组装里再出现 `rmSync(join(staticDir, ".env"))` 这种各写一套
    expect(buildDesktop).not.toMatch(/rmSync\(join\(staticDir, "\.env"/);
  });

  it("`pnpm build` 自身收尾就剥离（CI 只跑 build，不跑 build-desktop）", () => {
    expect(pkg.scripts.build).toContain("node scripts/standalone-private-inputs.mjs");
  });
});

describe("check-standalone-contents：产物层检查覆盖私有输入", () => {
  it("禁忌清单包含开发机私有输入与开发库文件", () => {
    expect(checker).toContain('["开发机私有输入"');
    expect(checker).toContain('["开发库文件"');
    // `.env` 与 db.sqlite 的形状都要能命中
    expect(checker).toMatch(/\\\.env\(/);
    expect(checker).toMatch(/db\\\.sqlite/);
  });

  it("同时检查 .next/standalone 与 src-tauri/static 两份产物", () => {
    expect(checker).toContain('const STATIC_DIR = path.join(ROOT, "src-tauri", "static")');
    expect(checker).toMatch(/checkDir\(STANDALONE/);
    expect(checker).toMatch(/checkDir\(STATIC_DIR/);
  });
});
