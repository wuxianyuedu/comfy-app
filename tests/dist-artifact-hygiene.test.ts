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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

// 运行时真的调用白名单剔除（不是只读源码文本）：嵌套条目 / 未登记新文件的
// 行为只有真删一次才看得出来。
import {
  FORBIDDEN_SHAPES,
  PRIVATE_SHAPES,
  RUNTIME_SCRIPTS,
  stripDevArtifacts,
  stripForbiddenShapes,
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
  expect(
    start,
    "check-standalone-contents.cjs 里找不到 ALLOWED_SCRIPTS",
  ).toBeGreaterThan(-1);
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
    for (const m of code.matchAll(
      /from\s+"(\.[^"]+)"|import\(\s*"(\.[^"]+)"\s*\)/g,
    )) {
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
    expect(pkg.scripts.build).toContain(
      "node scripts/standalone-private-inputs.mjs",
    );
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
    expect(checker).toContain(
      'const STATIC_DIR = path.join(ROOT, "src-tauri", "static")',
    );
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
      // 根级整目录：变更碎片与文档目录（产物实测有 747 个真碎片、73 个真文档，
      // 而 outputFileTracingExcludes 里同名的两条写了也没减）
      '"changelog.d"',
      '"docs"',
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
      expect(
        existsSync(join(dir, "scripts", "launcher-core", "orchestrator.mjs")),
      ).toBe(true);
      expect(
        existsSync(join(dir, "scripts", "launcher-core", "secret-new.mjs")),
      ).toBe(false);
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
    const mainBody = stripModule.slice(
      stripModule.lastIndexOf("function main()"),
    );
    expect(mainBody).toContain("stripPrivateInputs(standalone");
    expect(mainBody).toContain("stripDevArtifacts(standalone");
  });
});

/**
 * 取 `check-standalone-contents.cjs` 的禁忌清单（**真 require**，不是解析源码文本）。
 *
 * 为什么 require 而不是正则扫源码：那份清单里的条目会被 prettier 折行（实测
 * `["开发期配置", …]` 就是被折的那条），按文本取要么随格式无谓变红、要么把
 * `[^/]` 这种「字符类里的斜杠」切成半条正则（本文件前一版就是这么炸的：
 * `Invalid regular expression: Unterminated character class`）。require 拿到的是
 * ** RegExp 对象本身**，比对 `.source` 才是逐字比对。
 * 该脚本在 `require.main !== module` 时不会 `process.exit`（见文件尾的守卫）。
 */
function checkerForbidden(): Array<[string, RegExp]> {
  const mod = createRequire(import.meta.url)(
    "../scripts/check-standalone-contents.cjs",
  ) as {
    FORBIDDEN: Array<[string, RegExp]>;
  };
  // 解析退化（清单改名 / 导出漏项）会让下面所有断言静默变成「什么都没核对」——
  // 而这正是「清单核对型」判据最危险的失效形态，先要求它数到东西
  expect(mod.FORBIDDEN.length).toBeGreaterThan(8);
  return mod.FORBIDDEN;
}

/** 某个标签在禁忌清单里的全部正则原文（同名的可以有多条）。 */
function forbiddenSourcesFor(tag: string): string[] {
  return checkerForbidden()
    .filter(([entryTag]) => entryTag === tag)
    .map(([, re]) => re.source);
}

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
    // 是正常且必需的，误报会让这条护栏变成噪声。判的是「正则首字符」，
    // 所以走 require 拿到的 RegExp 本体（prettier 折行不该让它变红）。
    for (const tag of [
      "开发期文件",
      "开发期配置",
      "门禁锁文件",
      "TS 增量编译缓存",
    ]) {
      const sources = forbiddenSourcesFor(tag);
      expect(sources, `禁忌清单缺 ["${tag}"] 这一条`).not.toHaveLength(0);
      for (const source of sources) {
        expect(
          source.startsWith("^"),
          `["${tag}"] 的 ${source} 没锚在产物根`,
        ).toBe(true);
      }
    }
  });
});

/* ── 形状级剔除：测试文件 / 变更碎片 / 依赖包自带的文档 ────────────────────
 *
 * 为什么按目录名删（DEV_ARTIFACTS）不够：这三类有一大块不在产物根，而是藏在
 * `build-desktop` 解引用之后的依赖包里 —— 实测 `src-tauri/static` 里有 472 个
 * `node_modules/<pkg>/docs/` 下的 .md、24 个 `src/` 下的 .test.tsx，都不是「某个根目录」。
 * 而 `outputFileTracingExcludes` 里同形状的条目写了也不减（规范 §7.2）。
 */

/** 目录链接：Windows 走 "junction"、其它平台走 "dir"。`"dir"` 在 Windows 普通
 *  权限下必 EPERM（与 `tests/check-reformat-only.test.ts` 同一处理）。 */
function symlinkDir(target: string, linkPath: string): void {
  symlinkSync(
    target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

describe("产物层的形状级剔除（stripForbiddenShapes）", () => {
  it("真删一次：形状命中的删掉，没命中的一个都不碰", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-shape-"));
    const hits = [
      // src 下的测试文件（产物根与嵌套的 static/src 都算）
      "src/lib/foo.test.ts",
      "src/components/bar.test.tsx",
      "src-tauri/static/src/lib/baz.test.ts",
      // 依赖包自带的文档（解引用后是真文件）
      "node_modules/next/dist/docs/01-app/index.md",
      "node_modules/pino/docs/api.md",
      // 嵌套的变更碎片（根级那份由 DEV_ARTIFACTS 整目录删）
      "src-tauri/static/changelog.d/a.md",
      // 命中：藏在子目录里的开发库与密钥文件（PRIVATE_INPUTS 只删产物根那一层，
      // 实测 check-standalone-contents.cjs 在 static 上报出过 prisma/db.sqlite）
      "prisma/db.sqlite",
      "src/lib/db.sqlite-wal",
      "node_modules/some-app/.env.production",
    ];
    const keeps = [
      // 同目录下的真代码：运行时依赖，绝不能碰
      "src/lib/real.ts",
      "node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js",
      // docs 目录里的非 .md：形状只判文档，不判包里的代码与清单
      "python-venv/comfy-cli/Lib/site-packages/docs/conf.py",
      "node_modules/next/dist/docs/manifest.json",
      // 名字像但不是形状：`.env` 必须是**整段文件名**，`frontend.ts` 不是测试文件
      "src/lib/env-config.ts",
      "src/components/editor.ts",
      // 根级 README 不在这几条形状里（它归 DEV_ARTIFACTS 整条目删）
      "README.md",
    ];
    try {
      for (const rel of [...hits, ...keeps]) {
        mkdirSync(join(dir, dirname(rel)), { recursive: true });
        writeFileSync(join(dir, rel), "x");
      }
      const removed = stripForbiddenShapes(dir);
      expect(removed.sort()).toEqual([...hits].sort());
      for (const rel of hits) expect(existsSync(join(dir, rel))).toBe(false);
      for (const rel of keeps) expect(existsSync(join(dir, rel))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("被掏空的 docs 目录顺手收掉，还有内容的留着", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-empty-"));
    try {
      for (const rel of [
        "node_modules/pino/docs/api.md",
        "node_modules/next/dist/docs/01-app/index.md",
        "node_modules/next/dist/docs/manifest.json",
      ]) {
        mkdirSync(join(dir, dirname(rel)), { recursive: true });
        writeFileSync(join(dir, rel), "x");
      }
      stripForbiddenShapes(dir);
      expect(existsSync(join(dir, "node_modules", "pino", "docs"))).toBe(false);
      expect(
        existsSync(join(dir, "node_modules", "next", "dist", "docs")),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 这条是**安全**判据，不是清洁度判据：`.next/standalone/node_modules/<pkg>` 实测是
   * 指向本仓库 `node_modules/.pnpm/...` 的链接，顺着链接删会把开发机的依赖删掉
   * （4.3M 的 `next/dist/docs` 在产物清单里出现就是这么来的 —— 那是开发机的文件，
   * 不是产物的）。剔除侧必须按 `lstat` 停住，产物探针同理。
   */
  it("绝不穿符号链接删：链接背后的开发机 store 内容不受影响", () => {
    const store = mkdtempSync(join(tmpdir(), "comfyapp-store-"));
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-link-"));
    try {
      mkdirSync(join(store, "docs"), { recursive: true });
      mkdirSync(join(store, "src", "lib"), { recursive: true });
      writeFileSync(join(store, "docs", "api.md"), "doc");
      writeFileSync(join(store, "src", "lib", "foo.test.ts"), "test");
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      symlinkDir(store, join(dir, "node_modules", "pino"));

      expect(stripForbiddenShapes(dir)).toEqual([]);
      expect(existsSync(join(store, "docs", "api.md"))).toBe(true);
      expect(existsSync(join(store, "src", "lib", "foo.test.ts"))).toBe(true);
      // 链接本身也不能被删掉：删了它产物的模块解析就断了
      expect(existsSync(join(dir, "node_modules", "pino"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(store, { recursive: true, force: true });
    }
  });

  it("stripDevArtifacts 也跑形状剔除（两处复用同一条兜底）", () => {
    // 剔除实现必须挂在 stripDevArtifacts 里：`pnpm build` 收尾清 standalone、
    // build-desktop 清 static 都走这一个函数，另写一处就会漂移
    expect(stripDevArtifactsBody).toContain("stripForbiddenShapes(dir");
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-dev-"));
    try {
      for (const rel of [
        "src/lib/foo.test.ts",
        "AGENTS.md",
        "scripts/gate-new.cjs",
      ]) {
        mkdirSync(join(dir, dirname(rel)), { recursive: true });
        writeFileSync(join(dir, rel), "x");
      }
      stripDevArtifacts(dir);
      expect(existsSync(join(dir, "src", "lib", "foo.test.ts"))).toBe(false);
      expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
      expect(existsSync(join(dir, "scripts", "gate-new.cjs"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 剔除侧与检查侧的形状必须逐字相同：漂移的两种表现都白跑 ——
   * 「删掉了却仍判违规」让构建后检查常年红，「判违规却没人删」让产物常年带垃圾。
   * 覆盖两张形状表（三类开发垃圾 + 两类密钥/开发库），因为剔除侧实际用的是它们的并集。
   */
  it("形状清单与 check-standalone-contents.cjs 的禁忌清单逐字同源", () => {
    // 剔除侧那两张表来自 `.mjs`（无类型声明），解构出来是 `string | RegExp`，
    // 按实际结构标注一次；判据本身读的是 RegExp 本体
    const stripShapes = [...PRIVATE_SHAPES, ...FORBIDDEN_SHAPES] as Array<
      [string, RegExp]
    >;
    for (const [tag, re] of stripShapes) {
      expect(
        forbiddenSourcesFor(tag),
        `检查侧 ["${tag}"] 与剔除侧的 ${re.source} 不同源（或整条缺失）`,
      ).toEqual([re.source]);
    }
    expect(FORBIDDEN_SHAPES.map(([tag]) => tag)).toEqual([
      "测试文件",
      "变更碎片",
      "文档目录",
    ]);
    expect(PRIVATE_SHAPES.map(([tag]) => tag)).toEqual([
      "开发机私有输入",
      "开发库文件",
    ]);
  });
});
