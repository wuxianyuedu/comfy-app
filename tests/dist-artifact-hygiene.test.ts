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
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import { symlinkDir } from "./helpers/symlink-dir";

// 运行时真的调用白名单剔除（不是只读源码文本）：嵌套条目 / 未登记新文件的
// 行为只有真删一次才看得出来。
import {
  FORBIDDEN_SHAPES,
  PRIVATE_SHAPES,
  RUNTIME_SCRIPTS,
  RUNTIME_SRC,
  STANDALONE_ALLOWED_TOPLEVEL,
  STATIC_ALLOWED_TOPLEVEL,
  pruneStandaloneToAllowList,
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

/* ── 整包上提之后两侧判据必须仍然同形（ISSUE #1216 与 #1220 的交界）───────── */

describe("桌包载荷里的第三方包文档：判它的删它，谁都不让路", () => {
  it("产物护栏判它违规、形状清单负责删掉它", () => {
    // §载荷实体化 上提后的包是 store 里的**整包**，自带 docs（实测 static 层
    // 472 个：`node_modules/next/dist/docs/**` 456 个 + pino 等 16 个）。
    // 本刀一度想给护栏加「node_modules 豁免」来消掉这条红——**不要那样修**：
    // 加了豁免，将来漏剥就再没人知道。两侧同判据才是闭合的：护栏说要不得，
    // 剔除侧真删得掉（组装步 2.2 就删了，实测在实体化之后再跑一次命中 0 个）。
    const rel = "node_modules/next/dist/docs/index.md";
    const { FORBIDDEN } = checkerExports();
    expect(
      FORBIDDEN.some(([, re]) => re.test(rel)),
      "「文档目录」那条禁忌必须命中第三方包文档",
    ).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "comfyapp-hoisted-"));
    try {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      writeFileSync(join(dir, rel), "docs");
      expect(stripForbiddenShapes(dir)).toEqual([rel]);
      expect(existsSync(join(dir, rel))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
 * `check-standalone-contents.cjs` 的导出面（**真 require**，不是解析源码文本）。
 *
 * 为什么 require 而不是正则扫源码：那份清单里的条目会被 prettier 折行（实测
 * `["开发期配置", …]` 就是被折的那条），按文本取要么随格式无谓变红、要么把
 * `[^/]` 这种「字符类里的斜杠」切成半条正则（本文件前一版就是这么炸的：
 * `Invalid regular expression: Unterminated character class`）。require 拿到的是
 * **RegExp 对象本身**与**真函数**，比对与调用才作数。
 * 该脚本在 `require.main !== module` 时不会 `process.exit`（见文件尾的守卫）。
 */
interface CheckerExports {
  FORBIDDEN: Array<[string, RegExp]>;
  REQUIRED_RUNTIME_FILES: string[];
  REQUIRED_HOST_FILES: string[];
  REQUIRED_PAYLOAD_FILES: string[];
  RUNTIME_DIR: string;
  STANDALONE_ALLOWED_TOPLEVEL: string[];
  STATIC_ALLOWED_TOPLEVEL: string[];
  ALLOWED_SRC_FILES: string[];
  allowedTopLevelFor: (label: string) => string[];
  isAllowedSrcPath: (rel: string) => boolean;
  collectFiles: (dir: string, followLinks: boolean) => string[];
  missingRequiredRuntimeFiles: (dir: string) => string[];
  checkDir: (dir: string, label: string) => boolean;
}

function checkerExports(): CheckerExports {
  return createRequire(import.meta.url)(
    "../scripts/check-standalone-contents.cjs",
  ) as CheckerExports;
}

function checkerForbidden(): Array<[string, RegExp]> {
  const { FORBIDDEN } = checkerExports();
  // 解析退化（清单改名 / 导出漏项）会让下面所有断言静默变成「什么都没核对」——
  // 而这正是「清单核对型」判据最危险的失效形态，先要求它数到东西
  expect(FORBIDDEN.length).toBeGreaterThan(8);
  return FORBIDDEN;
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
      // 实测 check-standalone-contents.cjs 在 static 上报出过旧布局下嵌着的 db.sqlite）
      "legacy-dir/db.sqlite",
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

/* ── 「必须有的」反向检查：两层产物都要数（规范 §7.4）─────────────────────
 *
 * 此前这段只在 `label === "standalone"` 时跑，而最终被编译期内嵌进 exe 的是
 * `build-desktop` 组装后的 `src-tauri/static` —— 整树 `dereference: true` 拷贝与白名单
 * 剪枝全发生在 standalone 那一次检查**之后**。缺 `app-route-turbo` 在 exe 里的表现与在
 * 构建目录里一模一样（页面正常、接口全 500），所以「构建期过了」推不出「出厂件也在」。
 */
describe("Next 运行时脚本缺件检查覆盖两层产物", () => {
  const NAMES: [string, string, string] = [
    "app-route-turbo.runtime.prod.js",
    "app-page-turbo.runtime.prod.js",
    "pages-turbo.runtime.prod.js",
  ];

  /**
   * 造一份「确实是个产物」的最小目录：有 `server.js`，运行时脚本按传入子集铺。
   *
   * 宿主那三件与桌包载荷那三件也一并铺齐 —— `checkDir` 里那条 `missingHost` 与
   * `missingPayload` 同样以「有 server.js」为前提，不铺齐的话本用例报出来的红就不是
   * 我们要验的那一条（变量必须只有一个）。它们各自的内容与「同形」由
   * `tests/standalone-runtime.test.ts` 与 `tests/executor-host-artifact.test.ts` 守。
   */
  function makeProduct(dir: string, present: string[]): void {
    const mod = checkerExports();
    writeFileSync(join(dir, "server.js"), "// entry");
    for (const rel of [
      ...mod.REQUIRED_HOST_FILES,
      ...mod.REQUIRED_PAYLOAD_FILES,
    ]) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "// host");
    }
    for (const name of present) {
      const abs = join(dir, mod.RUNTIME_DIR, name);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "runtime");
    }
  }

  it("齐件判 0 缺、少一件就点名那一件（不是恒绿也不是恒红）", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-req-"));
    try {
      makeProduct(dir, NAMES);
      expect(checkerExports().missingRequiredRuntimeFiles(dir)).toEqual([]);
      rmSync(join(dir, checkerExports().RUNTIME_DIR, NAMES[0]), {
        force: true,
      });
      expect(checkerExports().missingRequiredRuntimeFiles(dir)).toEqual([
        NAMES[0],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 这条是**本次修复的本体**：同一份缺件目录，label 传 `"static"` 也必须报。
   *
   * 判据落在行为上（真调用 `checkDir` 并捕输出），而不是「源码里还有没有那个
   * `if (label === …)`」—— 结构断言在别人换一种写法时会无谓变红，或反过来在检查
   * 真的被删掉时变成无谓的绿。
   */
  it("static（真正被内嵌进 exe 的那一层）也报缺件", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-static-req-"));
    const lines: string[] = [];
    // 两个通道都按住：checkDir 的「✓ 产物干净」走 console.log，不接住会往测试输出里灌噪声
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.join(" "));
      });
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.join(" "));
      });
    try {
      // 故意少 app-route-turbo
      makeProduct(dir, NAMES.slice(1));
      expect(checkerExports().checkDir(dir, "static")).toBe(true);
      expect(
        lines.some(
          (line) =>
            line.includes("[static]") && line.includes("Next 运行时脚本缺件"),
        ),
        "static 层没被缺件检查覆盖：组装与剪枝发生在那之后，没人看第二眼",
      ).toBe(true);

      // 反向对照：同一份目录把件补齐就该放行（证明上面那条不是恒红）
      lines.length = 0;
      makeProduct(dir, [NAMES[0]]);
      expect(checkerExports().checkDir(dir, "static")).toBe(false);
      expect(lines.join(" ")).not.toContain("Next 运行时脚本缺件");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * 两个口径的分工也得钉住，否则下次有人「统一成一份清单」就会一边假红一边假绿：
   * standalone 的 `node_modules/next` 是指向 pnpm store 的**链接**，
   * 「必须有的」按可达判（经链接 require 得到就算在位），
   * 「不该有的」按真文件判（不穿链接，否则把开发机内容算成产物内容）。
   */
  it("判「必须有的」穿链接可达即算在位，判「不该有的」不穿", () => {
    const store = mkdtempSync(join(tmpdir(), "comfyapp-store-rt-"));
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-link-rt-"));
    const { RUNTIME_DIR, collectFiles, missingRequiredRuntimeFiles } =
      checkerExports();
    /**
     * 链接挂在 `node_modules/next` 上，所以 `store` 扮演的就是 next **包本身**：
     * 里面的相对路径是 RUNTIME_DIR 去掉 `node_modules/next/` 前缀的那一段。
     */
    const insidePkg = RUNTIME_DIR.replace(/^node_modules\/next\//, "");
    try {
      for (const name of NAMES) {
        const abs = join(store, insidePkg, name);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, "runtime");
      }
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(join(dir, "server.js"), "// entry");
      symlinkDir(store, join(dir, "node_modules", "next"));

      // 运行时经链接 require 得到 → 判「必须有的」不能报缺件（那是假红）
      expect(missingRequiredRuntimeFiles(dir)).toEqual([]);
      // 同一份目录按「真文件」口径数：链接背后的内容不算产物内容
      const real = collectFiles(dir, false);
      expect(real).not.toContain(`${RUNTIME_DIR}/${NAMES[0]}`);
      // 链接本身算一项产物内容（探针不空跑）
      expect(real).toContain("node_modules/next");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(store, { recursive: true, force: true });
    }
  });
});

/* ── 顶层默认拒绝（ISSUE #1217）──────────────────────────────────────────
 * 判据方向与 FORBIDDEN 相反：那份是黑名单，每多一个被 tracing 带进来的目录就要有人
 * 记得补一条，**漏掉是静默的**。实测同一次构建走 Turbopack 时
 * `outputFileTracingExcludes` 对整目录条目一条都不减 —— 40 个顶层条目 / 19274 个真文件，
 * 里面躺着 `src-tauri` 8516 个、`python-venv` 5356 个、`db.sqlite`+WAL/SHM、`.env`，
 * 还有仓库根那个 `Comfy APP.lnk`；而**跑完当时那套按名字的剔除清单之后仍然剩 19 个顶层
 * 条目**（`log/` 100 份开发日志、`tests`、`e2e`、`tools`、`build-launcher`、`run`、`temp`、
 * 两份 `*.config.*`、那个 `.lnk` 全活着）。所以这一格改成「只允许运行时必需那几件」。
 *
 * 三条用例各钉一件事：两份清单逐字同源（漂移两头都白跑）、凭空多一个顶层条目必须红
 * （反向对照证明它不是恒红）、剔除侧真删得动。 */
describe("产物顶层的默认拒绝（ISSUE #1217）", () => {
  it("检查侧与剔除侧的顶层清单逐字同源，且不是空清单", () => {
    const mod = checkerExports();
    expect(mod.STANDALONE_ALLOWED_TOPLEVEL).toEqual(
      STANDALONE_ALLOWED_TOPLEVEL,
    );
    expect(mod.STATIC_ALLOWED_TOPLEVEL).toEqual(STATIC_ALLOWED_TOPLEVEL);
    expect(mod.ALLOWED_SRC_FILES).toEqual(RUNTIME_SRC);
    // 比对退化最常见的形态是两边都拿到 []，那时上面三条断言全部无意义地绿。
    expect(mod.STANDALONE_ALLOWED_TOPLEVEL.length).toBeGreaterThan(3);
    expect(mod.STATIC_ALLOWED_TOPLEVEL.length).toBeGreaterThan(3);
    // static 只比 standalone 多装配步产出的那三件（不许有人把源码树放进来）
    expect(
      mod.STATIC_ALLOWED_TOPLEVEL.filter(
        (n) => !mod.STANDALONE_ALLOWED_TOPLEVEL.includes(n),
      ),
    ).toEqual(["index.html", "schema.sql", "splash.html"]);
    expect(mod.STANDALONE_ALLOWED_TOPLEVEL).not.toContain("src");
    expect(mod.STANDALONE_ALLOWED_TOPLEVEL).not.toContain("next.config.js");
  });

  /** 造一份「顶层合法」的最小 standalone：四件必需 + 宿主三件 + 运行时脚本齐件。 */
  function makeMinimalStandalone(dir: string): void {
    const mod = checkerExports();
    writeFileSync(join(dir, "server.js"), "// entry");
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirSync(join(dir, ".next"), { recursive: true });
    mkdirSync(join(dir, "public"), { recursive: true });
    for (const rel of mod.REQUIRED_HOST_FILES) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "// host");
    }
    for (const name of mod.REQUIRED_RUNTIME_FILES) {
      const abs = join(dir, mod.RUNTIME_DIR, name);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "runtime");
    }
  }

  /** 捕 checkDir 的两个输出通道（「✓ 产物干净」走 log，违规走 error）。 */
  function captureCheck(
    dir: string,
    label: string,
  ): { failed: boolean; lines: string[] } {
    const lines: string[] = [];
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => {
        lines.push(a.join(" "));
      });
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        lines.push(a.join(" "));
      });
    try {
      return { failed: checkerExports().checkDir(dir, label), lines };
    } finally {
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
  }

  it("凭空多一个顶层条目 → 红并点名；补齐白名单形态就放行（不是恒红）", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-top-"));
    try {
      makeMinimalStandalone(dir);
      // 反向对照先跑：同一份目录合法时必须不红，否则下面那条「红」没有信息量。
      const clean = captureCheck(dir, "standalone");
      expect(clean.failed, clean.lines.join(" ")).toBe(false);

      mkdirSync(join(dir, "some-new-traced-dir"), { recursive: true });
      writeFileSync(join(dir, "Comfy APP.lnk"), "快捷方式");
      const dirty = captureCheck(dir, "standalone");
      expect(dirty.failed).toBe(true);
      const report = dirty.lines.join(" ");
      expect(report).toContain("顶层出现白名单外的条目");
      expect(report).toContain("some-new-traced-dir");
      expect(report).toContain("Comfy APP.lnk");
      // 红话必须给出路：报「谁在运行期读它」这个问题，而不是让人往 excludes 补一条。
      expect(report).toContain("谁在运行期读它");
      expect(report).toContain("standalone-private-inputs.mjs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("剔除侧真跑一遍：陌生顶层被删掉，必需件与 src 里那条一个不碰", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfyapp-top-prune-"));
    try {
      makeMinimalStandalone(dir);
      // src 是「祖先放行、叶子逐文件判」：RUNTIME_SRC 那条要留着，旁边的一起删掉。
      // 取 [0] 要判空（`noUncheckedIndexedAccess`），而这条用例的前提就是它存在。
      const runtimeSrcFile = RUNTIME_SRC[0];
      if (!runtimeSrcFile) throw new Error("RUNTIME_SRC 为空，本用例无从判断");
      const keep = join(dir, "src", ...runtimeSrcFile.split("/"));
      mkdirSync(dirname(keep), { recursive: true });
      writeFileSync(keep, "// runtime");
      writeFileSync(join(dir, "src", "secret-notes.ts"), "// 不该出去");
      mkdirSync(join(dir, "python-venv"), { recursive: true });
      writeFileSync(join(dir, "python-venv", "sitecustomize.py"), "#");
      writeFileSync(join(dir, "AGENTS.md"), "# 内部规范");

      const removed = pruneStandaloneToAllowList(dir);
      expect(removed).toContain("python-venv");
      expect(removed).toContain("AGENTS.md");
      // 剔除侧报的是 POSIX 风格相对路径（与 FORBIDDEN_SHAPES 的判据同形），别按平台分隔符断言。
      expect(removed).toContain("src/secret-notes.ts");
      expect(existsSync(join(dir, "src", "secret-notes.ts"))).toBe(false);
      expect(existsSync(join(dir, "python-venv"))).toBe(false);
      expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
      // 必需件与那条运行期 TS 源不许被牵连
      expect(existsSync(join(dir, "server.js"))).toBe(true);
      expect(existsSync(keep)).toBe(true);
      expect(existsSync(join(dir, ".next"))).toBe(true);
      // 剪完再让判据数一次：应当放行（两侧口径此时才叫真对上）
      expect(captureCheck(dir, "standalone").failed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("构建收尾真接上了这一刀（main 里不调，它就只是个被导出的函数）", () => {
    const mainBody = stripModule.slice(
      stripModule.lastIndexOf("function main()"),
    );
    expect(mainBody).toContain("pruneStandaloneToAllowList(standalone");
  });

  it("判据接进 `pnpm build`，且排在减法之后、冒烟之前", () => {
    const build = pkg.scripts.build ?? "";
    const iStrip = build.indexOf("standalone-private-inputs.mjs");
    const iCheck = build.indexOf("check-standalone-contents.cjs");
    const iSmoke = build.indexOf("smoke-executor-host-standalone.mjs");
    expect(iCheck).toBeGreaterThan(-1);
    // 顺序是判据：先减法、再数产物，最后才真起进程（冒烟对最终产物负责）。
    expect(iStrip).toBeGreaterThanOrEqual(0);
    expect(iStrip).toBeLessThan(iCheck);
    expect(iCheck).toBeLessThan(iSmoke);
  });
});
