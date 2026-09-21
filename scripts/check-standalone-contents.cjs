#!/usr/bin/env node
// @ts-nocheck -- 构建产物护栏（供 CI 在 `pnpm build` 之后调用）
/**
 * standalone 产物内容护栏 —— 规范见 docs/standards/launch-and-build.md §7.2。
 *
 * 背景（ISSUE #489）：`next build`（Turbopack）对无法静态收敛的动态路径访问
 * 会打 `Dynamic filesystem access causes tracing of the whole project`，并把
 * **整个项目**当作 server code 依赖复制进 `.next/standalone`。真正的防线是
 * `next.config.js` 的 `outputFileTracingExcludes`（工作在产物路径层面）。
 *
 * 但「清单还在」不等于「清单生效」——历史事故正是键位挂在 `experimental` 下
 * 一个字都没被读，却因为没有任何检查去数产物里的文件而无人察觉。
 * 本脚本在**构建之后**真去数 `.next/standalone`：测试文件 / 变更碎片 /
 * 文档目录绝不能出现在产物里（它们不可能是任何 server code 的运行时依赖）。
 *
 * 用法：node scripts/check-standalone-contents.cjs
 *   · 产物不存在时**跳过并不报错**（本脚本守的是构建结果，不是构建本身）
 *   · 发现不该有的文件时非零退出，并列出前若干个样本
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");
/** build-desktop.mjs 的组装结果（最终被编译期内嵌进 exe）。 */
const STATIC_DIR = path.join(ROOT, "src-tauri", "static");

/** 不该出现在 standalone 里的东西：[标签, 相对路径正则] */
const FORBIDDEN = [
  ["测试文件", /(^|\/)src\/.*\.test\.tsx?$/],
  ["变更碎片", /(^|\/)changelog\.d\/.*\.md$/],
  ["文档目录", /(^|\/)docs\/.*\.md$/],
  // 开发机私有输入：`.env` 会被 Next standalone 无条件复制，`db.sqlite` 由动态
  // 路径 tracing 带入（两者都实测复现）。它们随 static 被编译期内嵌进 exe ——
  // 密钥明文随包分发，开发库还会成为应用首次启动时读写的那个库（见
  // scripts/build-desktop.mjs 的「分发卫生」一节）。这里连同 SQLite 的 WAL/SHM
  // 边车文件一起拦。清单是**欠完备**的：新形态（如 `.env.*.local`）不会自动命中，
  // 真正的兜底是产物层数文件，不是清单本身。
  ["开发机私有输入", /(^|\/)\.env(\.[^/]*)?$/],
  ["开发库文件", /(^|\/)db\.sqlite(-wal|-shm)?$/],
  // 开发期文件与内部门禁脚本（ISSUE #489）：全项目 tracking 会把仓库根的
  // AGENTS.md / CHANGELOG.md / 各 *.config.* 与整套 scripts/** 复制进产物，
  // 进而随 static 被编译期内嵌进 exe —— 解包即得内部规范全文与全部门禁脚本。
  // 判据不是体积，而是「路由只 import 编译产物，这些不可能是运行时依赖」。
  // scripts/ 用**白名单**：只有运行时真的会读的那几个允许存在（见下）。
  // 注意：都锚在**产物根**（`^`），不匹配 node_modules 里的同名文件 —— 第三方包
  // 自带 README / tsconfig.json / eslint.config.js 是正常且必需的，把它们算违规
  // 会让这条护栏变成噪声，进而被当成「反正都红」而忽略。
  ["开发期文件", /^(AGENTS|CHANGELOG|README)\.md$/],
  ["开发期配置", /^(eslint|playwright|prettier|drizzle|vitest)\.config\.[cm]?[jt]s$/],
  ["开发期配置", /^(components|tsconfig|typedoc)\.json$/],
  ["门禁锁文件", /^pnpm-(lock|workspace)\.ya?ml$/],
  ["TS 增量编译缓存", /^tsconfig\.tsbuildinfo$/],
  ["Python 字节码缓存", /^__pycache__\//],
];

/**
 * scripts/ 下允许出现在产物里的条目（**白名单**）。
 *
 * 判据是「运行时真的会读」——目前只有两处，且都在代码里能指到：
 *   · install-comfyapp-helper.ps1：src/app/api/helper/{install,status}/route.ts
 *     以 process.cwd() 拼路径把它当下载内容返回（installerAvailable 也靠它判）；
 *   · dev-launcher.mjs（+ 其相对 import 闭包里的 session / app-port / 两道预检 /
 *     lockfile 差异 / launcher-core/*）：
 *     启动编排的唯一实现，也是 src-tauri/src/lib.rs::looks_like_project_root()
 *     的项目根判据；dev-launcher.ps1 只是它的 Windows 调用入口。
 *     **清单必须与 scripts/standalone-private-inputs.mjs 的 RUNTIME_SCRIPTS 同源**
 *     （集合相同，由 tests/dist-artifact-hygiene.test.ts 核对）：两处漂移的表现是
 *     「剔除时保留、检查时判违规」或反过来（保留清单漏了 → 产物里缺件、启动即崩）。
 *
 * 为什么白名单而不是黑名单：黑名单欠完备，每加一个根级文件/脚本就要记得补一条，
 * 而漏掉是静默的（上一次 db.sqlite 就是这么漏的）。白名单下新增脚本默认不进产物，
 * 要留下必须显式登记并写清理由。
 */
const ALLOWED_SCRIPTS = new Set([
  "install-comfyapp-helper.ps1",
  "dev-launcher.mjs",
  "dev-launcher.ps1",
  "dev-launcher-session.mjs",
  "app-port.mjs",
  "env-preflight.mjs",
  "db-schema-state.mjs",
  "db-push-core.mjs",
  "reap-process.mjs",
  "lockfile/render-lock-diff.mjs",
  "lockfile/lock-diff.mjs",
  // 编排器的内部分件（逐项登记；与 RUNTIME_SCRIPTS 同源）
  "launcher-core/procs.mjs",
  "launcher-core/shell.mjs",
  // shell.mjs / procs.mjs 的命令行回显出口（少这份 = 运行期 ERR_MODULE_NOT_FOUND）
  "launcher-core/command-echo.mjs",
  "launcher-core/log.mjs",
  "launcher-core/worktree.mjs",
  "launcher-core/orchestrator.mjs",
  "launcher-core/corepack.mjs",
  "launcher-core/splash-assets.mjs",
]);

/** Next 自带运行时脚本目录（相对产物根）。 */
const RUNTIME_DIR = "node_modules/next/dist/compiled/next-server";

/**
 * 必须出现在产物里的运行时脚本（**逐个点名**，不用通配）。
 *
 * 缺任何一份的后果都是运行期 500 而非构建报错，所以只能靠产物层数文件发现
 * （规范 §7.4）。补法：next.config.js 的 outputFileTracingIncludes —— excludes
 * 只做减法，补不回缺失的文件。
 */
const REQUIRED_RUNTIME_FILES = [
  "app-route-turbo.runtime.prod.js", // 所有 route.ts
  "app-page-turbo.runtime.prod.js", // RSC 页面
  "pages-turbo.runtime.prod.js", // middleware
];

function listFiles(dir, prefix, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue; // 断链（pnpm symlink 等），跳过
    }
    if (st.isDirectory()) listFiles(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * 数一份产物的文件并做同一份禁忌清单检查。
 * @param {string} dir 产物目录
 * @param {string} label 输出前缀
 * @returns {boolean} 是否发现违规
 */
function checkDir(dir, label) {
  const files = listFiles(dir, "", []);
  let failed = false;
  // scripts/ 白名单：产物里的每个文件都必须是登记过的（支持嵌套路径，
  // 逐项登记而不是放行整个目录 —— 目录级放行会让以后新增的脚本自动进产物）。
  // 这条比正则表更严：新脚本进来即命中，不需要有人先想到去正则里补形状。
  const strayScripts = files.filter((f) => {
    const m = /^scripts\/(.+)$/.exec(f);
    return m && !ALLOWED_SCRIPTS.has(m[1]);
  });
  // Next 自带运行时脚本**反向检查**：这里查的不是「不该有的」而是「必须有的」。
  // Turbopack 对 `require("next/dist/compiled/next-server/<name>.runtime.prod.js")`
  // 这类动态 require 字符串的追踪不完整（实测只追到被 middleware 命中的
  // app-page-turbo），缺件的表现是**所有 API 路由 500**
  // （Failed to load external module），而构建期毫无提示。防线是 next.config.js
  // 的 outputFileTracingIncludes —— 但「清单还在」不等于「清单生效」（历史事故
  // 已经吃过一次），所以这里真去数文件。规范 §7.4。
  if (label === "standalone") {
    const missingRuntime = REQUIRED_RUNTIME_FILES.filter(
      (name) => !files.includes(`${RUNTIME_DIR}/${name}`),
    );
    if (missingRuntime.length > 0) {
      failed = true;
      console.error(
        `[${label}] Next 运行时脚本缺件 ${missingRuntime.length} 个：\n  ` +
          missingRuntime.join("\n  ") +
          "\n  后果是所有 App Route 返回 500（页面正常、接口全挂）。" +
          "请确认 next.config.js 的 outputFileTracingIncludes 仍在（§7.4）。",
      );
    }
  }
  if (strayScripts.length > 0) {
    failed = true;
    console.error(
      `[${label}] 内部门禁脚本不该进产物，却发现 ${strayScripts.length} 个：\n  ` +
        strayScripts.slice(0, 8).join("\n  ") +
        (strayScripts.length > 8 ? `\n  …（其余 ${strayScripts.length - 8} 个省略）` : "") +
        "\n  （runtime 真的会读的脚本靠 ALLOWED_SCRIPTS 白名单保留；" +
        "新增脚本默认应被剔除，要保留请登记并说明理由）",
    );
  }
  for (const [tag, re] of FORBIDDEN) {
    const hits = files.filter((f) => re.test(f));
    if (hits.length > 0) {
      failed = true;
      console.error(
        `[${label}] ${tag}不该进产物，却发现 ${hits.length} 个：\n  ` +
          hits.slice(0, 8).join("\n  ") +
          (hits.length > 8 ? `\n  …（其余 ${hits.length - 8} 个省略）` : ""),
      );
    }
  }
  if (!failed) {
    console.log(
      `[${label}] ✓ 产物干净（共 ${files.length} 个文件，无测试 / 文档 / 变更碎片 / 开发机私有输入 / 开发期文件与门禁脚本）`,
    );
  }
  return failed;
}

function main() {
  let failed = false;

  if (fs.existsSync(STANDALONE)) {
    failed = checkDir(STANDALONE, "standalone") || failed;
  } else {
    console.log(
      "[standalone] 未找到 .next/standalone，跳过（本检查在 `pnpm build` 之后运行才有意义）",
    );
  }

  // src-tauri/static 是 build-desktop.mjs 的组装结果（最终被编译期内嵌进 exe），
  // 比 .next/standalone 更接近用户拿到的东西；存在就一起查。
  if (fs.existsSync(STATIC_DIR)) {
    failed = checkDir(STATIC_DIR, "static") || failed;
  }

  if (failed) {
    console.error(
      "\n[standalone] 请检查两处：① next.config.js 的 outputFileTracingExcludes" +
        "（键位必须在顶层，Next 16 已把它从 experimental 升为顶层键；写在旧位置" +
        "一个字都不会被读）；② scripts/build-desktop.mjs 的「分发卫生」剔除清单" +
        "（.env / db.sqlite* / AGENTS.md / 各 *.config.* / scripts/** 只能靠显式删除，" +
        "excludes 对 .env 与文件类条目实测无效）。规范 §7.2、§7.3。",
    );
    return 1;
  }
  return 0;
}

process.exit(main());
