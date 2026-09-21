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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

// 运行时真的调用白名单剔除（不是只读源码文本）：嵌套条目 / 未登记新文件的
// 行为只有真删一次才看得出来。
import {
  RUNTIME_SCRIPTS,
  stripDevArtifacts,
} from "../scripts/standalone-private-inputs.mjs";

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

/* ── 白名单判据的两个取样器（供下面的用例共用）────────────────────────── */

/** 从 `check-standalone-contents.cjs` 源码里取出 ALLOWED_SCRIPTS 的字面量集合。 */
function allowedScriptsFromChecker(source: string): string[] {
  const start = source.indexOf("const ALLOWED_SCRIPTS = new Set([");
  expect(start, "check-standalone-contents.cjs 里找不到 ALLOWED_SCRIPTS").toBeGreaterThan(
    -1,
  );
  const body = source.slice(start, source.indexOf("]);", start));
  return [...body.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((name): name is string => typeof name === "string");
}

/**
 * 收集某个模块的**相对 import 闭包**（只跟 `scripts/` 下的 `.mjs`，返回相对 `scripts/` 的路径）。
 *
 * 判据为什么是源码解析而不是 `import()` 真加载：真加载会执行编排器的顶层代码
 * （它会跑预检、写会话锚点），那份代价与风险不该由一条清单判据承担 —— 这里要回答的
 * 只是「产物里重编排时会不会缺件」，静态说明符出现即成立（ESM 加载期解析整张图）。
 * 行注释必须先剥掉：JSDoc 里的 `import("../lockfile/lock-diff.d.mts")` 是类型引用，
 * 不是运行期依赖（登记它反而违背「运行时真的会读」这条判据）。
 */
function collectRelativeClosure(entry: string): string[] {
  const scriptsRoot = join(process.cwd(), "scripts");
  const seen = new Set<string>();
  const walk = (file: string): void => {
    const rel = relative(scriptsRoot, file).split("\\").join("/");
    if (seen.has(rel)) return;
    seen.add(rel);
    const code = readFileSync(file, "utf8")
      .split("\n")
      // 只剥「整行是注释」的形态：这几份脚本的 import 都在行首，足够用且不会
      // 误伤字符串里的 `//`（例如 URL）
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const m of code.matchAll(/from\s+"(\.[^"]+)"|import\(\s*"(\.[^"]+)"\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const target = resolve(dirname(file), spec);
      // `../src/**` 由 Next 的编译产物提供（不在 scripts/ 的白名单管辖内），
      // `.d.mts` 之类的类型声明也不参与运行期加载
      if (!target.startsWith(scriptsRoot) || !target.endsWith(".mjs")) continue;
      if (!existsSync(target)) continue;
      walk(target);
    }
  };
  walk(entry);
  return [...seen];
}

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
    // 断言「从该模块 import」而不是某一种写法：导入已被拆成多行（新增
    // stripDevArtifacts），逐字面量断言会随格式变化无谓变红。
    expect(buildDesktop).toMatch(
      /import\s*\{[^}]*stripPrivateInputs[^}]*\}\s*from\s*"\.\/standalone-private-inputs\.mjs"/,
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

/* ── 开发期文件与内部门禁脚本：白名单剔除（ISSUE #489）─────────────────── */
const stripDevArtifactsBody = stripModule.slice(
  stripModule.indexOf("export function stripDevArtifacts"),
);

describe("开发期文件与内部门禁脚本的白名单剔除", () => {
  it("剔除清单覆盖根级开发文件与各 *.config.*", () => {
    for (const name of [
      '"AGENTS.md"',
      '"CHANGELOG.md"',
      '"README.md"',
      '"eslint.config.js"',
      '"playwright.config.ts"',
      '"vitest.config.ts"',
      '"tsconfig.json"',
      '"pnpm-lock.yaml"',
      '"tsconfig.tsbuildinfo"',
    ]) {
      expect(stripModule, `剔除清单缺少 ${name}`).toContain(name);
    }
  });

  it("scripts/ 走白名单：运行时真的会读的逐个点名，新增脚本默认不进产物", () => {
    // 白名单的意义就在这里：黑名单欠完备（每加一个脚本都要记得补一条，
    // 而漏掉是静默的）。这里锁「白名单存在且条目被逐个点名」——
    // 把白名单换成黑名单、或改成目录级放行，都会让下面这条失败。
    expect(stripModule).toContain("export const RUNTIME_SCRIPTS = [");
    expect(stripModule).toContain('"install-comfyapp-helper.ps1"');
    expect(stripModule).toContain('"dev-launcher.mjs"');
    // 嵌套条目也要逐项登记（`launcher-core/*` 是编排器的运行期依赖，
    // 目录级放行会让以后新增的脚本自动进产物）
    expect(stripModule).toContain('"launcher-core/orchestrator.mjs"');
    // 剔除实现必须是「不在白名单里就删」，而不是「在黑名单里才删」
    expect(stripDevArtifactsBody).toContain("pruneNotWhitelisted(scriptsDir");
  });

  it("白名单剔除真跑：嵌套条目保留、未登记的新文件被剔", () => {
    // 静态断言看不出「嵌套条目到底生效没有」——给一份临时产物目录真删一次。
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-static-"));
    try {
      for (const rel of [
        "scripts/dev-launcher.mjs",
        "scripts/launcher-core/orchestrator.mjs",
        "scripts/launcher-core/secret-new.mjs",
        "scripts/gate-new.cjs",
        "AGENTS.md",
      ]) {
        mkdirSync(join(dir, dirname(rel)), { recursive: true });
        writeFileSync(join(dir, rel), "");
      }
      stripDevArtifacts(dir);
      expect(existsSync(join(dir, "scripts", "dev-launcher.mjs"))).toBe(true);
      expect(existsSync(join(dir, "scripts", "launcher-core", "orchestrator.mjs"))).toBe(true);
      expect(existsSync(join(dir, "scripts", "launcher-core", "secret-new.mjs"))).toBe(false);
      expect(existsSync(join(dir, "scripts", "gate-new.cjs"))).toBe(false);
      expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("build-desktop 也跑白名单剔除（static 是唯一能覆盖的那一层）", () => {
    expect(buildDesktop).toContain("stripDevArtifacts");
    expect(buildDesktop).toMatch(/stripDevArtifacts\(staticDir,/);
  });

  it("`pnpm build` 收尾就剔除（CI 只跑 build，不跑 build-desktop）", () => {
    // main() 里两个都要跑：只清私有输入不清开发文件，standalone 仍然带 AGENTS.md
    const mainBody = stripModule.slice(stripModule.lastIndexOf("function main()"));
    expect(mainBody).toContain("stripPrivateInputs(standalone");
    expect(mainBody).toContain("stripDevArtifacts(standalone");
  });
});

describe("check-standalone-contents：scripts/ 白名单与运行时缺件", () => {
  it("产物层检查持有与剔除清单一致的 scripts 白名单", () => {
    expect(checker).toContain('"install-comfyapp-helper.ps1"');
    expect(checker).toContain('"dev-launcher.mjs"');
    expect(checker).toContain('"launcher-core/orchestrator.mjs"');
    expect(checker).toContain("ALLOWED_SCRIPTS");
  });

  /**
   * 两份清单是同一件事的两个视角：剔除侧决定「产物里留什么」，检查侧决定
   * 「产物里出现什么算违规」。漂移的两种表现都很难查：剔除侧漏了 → 产物缺件、
   * 重编排起不来（表现只是「双击没反应」）；检查侧漏了 → 构建后检查把合法产物
   * 判成违规，而剔除明明保留了它。
   */
  it("两份白名单集合相同（漏在一处 = 剔除与检查互相打架）", () => {
    expect(new Set(allowedScriptsFromChecker(checker))).toEqual(
      new Set(RUNTIME_SCRIPTS),
    );
  });

  /**
   * 清单的判据是**编排器的相对 import 闭包**，不是「看着像运行时的都写上」：
   * `dev-launcher.mjs` 顶层是静态 import，ESM 加载期解析整张图 —— 少一份不是
   * 「那一步跳过」，而是整个编排器起不来。此前 `env-preflight` / `corepack` /
   * `splash-assets` / `lockfile/*` 就是这样漏在清单外的（登记靠人记，必漏）。
   */
  it("清单覆盖编排器的相对 import 闭包（新增内部分件漏登记即失败）", () => {
    const closure = collectRelativeClosure(
      join(process.cwd(), "scripts", "dev-launcher.mjs"),
    );
    // 闭包本身要有内容：解析退化（正则写坏、路径换了）会让这条断言静默变成
    // 「什么都没漏」，那正是这类清单判据最危险的失效形态
    expect(closure.length).toBeGreaterThan(10);
    const missing = closure.filter((rel) => !RUNTIME_SCRIPTS.includes(rel));
    expect(
      missing,
      "以下模块在 dev-launcher.mjs 的 import 闭包里却没登记进 RUNTIME_SCRIPTS —— " +
        "产物里走到重编排就是 ERR_MODULE_NOT_FOUND（用户只看得到「双击没反应」）",
    ).toEqual([]);
  });

  it("产物层检查也验「Next 运行时脚本不得缺件」", () => {
    // 这一条是**反向**检查（必须有的），与上面那些「不该有的」方向相反：
    // 缺 app-route-turbo 的表现是所有 API 路由 500，构建期却毫无提示。
    expect(checker).toContain("REQUIRED_RUNTIME_FILES");
    expect(checker).toContain("app-route-turbo.runtime.prod.js");
  });

  it("开发期文件的判据锚在产物根，不误伤 node_modules 里的同名文件", () => {
    // ^ 锚点不能丢：第三方包自带 README.md / tsconfig.json / eslint.config.js
    // 是正常且必需的，误报会让这条护栏变成噪声。
    expect(checker).toMatch(/\["开发期文件", \/\^\(AGENTS\|CHANGELOG\|README\)/);
    expect(checker).toMatch(/\["开发期配置", \/\^\(eslint\|playwright/);
  });
});
