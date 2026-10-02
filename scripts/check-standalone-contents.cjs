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
 * ⚠️ 实测口径（别再把 `outputFileTracingExcludes` 当防线）：那份清单里声明过的**整目录**
 * 条目对「全项目 tracing」带进来的文件一条都不减（`./changelog.d/` 对应 747 个真文件、
 * `./src/` 下的测试文件对应 406 个、`./src-tauri/` 对应 4553 个），只有单文件条目
 * （`./db.sqlite`）实测有效。**减法在 `scripts/standalone-private-inputs.mjs`**，
 * 本脚本负责证明减法真的发生了（规范 §7.2 第三/第六件事）。
 *
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
  [
    "开发期配置",
    /^(eslint|playwright|prettier|drizzle|vitest)\.config\.[cm]?[jt]s$/,
  ],
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
  // ComfyUI 执行器独立宿主（P3 §5 第 2 期 · Phase 2-C）：由 dev-launcher.mjs
  // 的 spawnExecutorHost 在 COMFY_EXECUTOR=host 灰度下起；桌面包里也要能起来。
  // 与 standalone-private-inputs.mjs 的 RUNTIME_SCRIPTS 同源，缺一份即红。
  "executor-host.mjs",
  // 宿主的预编译运行时图 + 构建清单（3-E1，ISSUE #1169）：构建期产出、不在仓库
  // 源码里，与 RUNTIME_SCRIPTS 同源登记（漂移的两头都难查：剔除侧漏 = 产物缺件，
  // 检查侧漏 = 把合法产物判成违规）。
  "executor-host.runtime.mjs",
  "executor-host.build.json",
  "lockfile/render-lock-diff.mjs",
  "lockfile/lock-diff.mjs",
  // 编排器的内部分件（逐项登记；与 RUNTIME_SCRIPTS 同源）
  "launcher-core/procs.mjs",
  "launcher-core/shell.mjs",
  // COMFY_EXECUTOR 判据的纯 Node 侧唯一定义（launcher 门控与 executor-host 都
  // 静态 import 它；ADR §14 D5）。缺它时 host 静默跑成骨架。
  "launcher-core/executor-mode.mjs",
  // shell.mjs / procs.mjs 的命令行回显出口（少这份 = 运行期 ERR_MODULE_NOT_FOUND）
  "launcher-core/command-echo.mjs",
  "launcher-core/log.mjs",
  "launcher-core/worktree.mjs",
  "launcher-core/orchestrator.mjs",
  "launcher-core/corepack.mjs",
  "launcher-core/splash-assets.mjs",
  // 桌包 standalone 的运行入口与它的环境装配（ISSUE #1216）：壳把 `node server.js`
  // 换成 `node scripts/standalone-runtime.mjs`，缺这份 = 载荷只能退回直接起 server，
  // 首启建表与运行期 env 装配（分发产物按硬规则 17 不含 .env）一起失效。
  "standalone-runtime.mjs",
  "launcher-core/standalone-runtime-env.mjs",
]);

/** Next 自带运行时脚本目录（相对产物根）。 */
const RUNTIME_DIR = "node_modules/next/dist/compiled/next-server";

/**
 * 两层产物各自允许的**顶层条目**（默认拒绝，ISSUE #1217）。
 *
 * 为什么这一层要按「顶层」判而不是继续往 `FORBIDDEN` 里补形状：那份清单是欠完备的
 * 黑名单，每多一个被 tracing 带进来的目录就要有人记得补一条，漏掉是静默的
 * （`db.sqlite` 当年就是这么漏的）。默认拒绝把方向反过来 —— 新增一个顶层目录
 * 必然被看见，要留下必须显式登记并写清理由。与剔除侧
 * （`scripts/standalone-private-inputs.mjs` 的 `STANDALONE_ALLOWED_TOPLEVEL` /
 * `STATIC_ALLOWED_TOPLEVEL`）**逐字同源**，由 `tests/dist-artifact-hygiene.test.ts`
 * 核对：漂移的表现是「剔掉了却判违规」或「判违规却没人删」，两边都白跑。
 *
 * 每一项为什么必需（两层共用）：`server.js` + `package.json` + `.next/` +
 * `node_modules/` 是 Next standalone 的四件必需（`server.js` 启动即
 * `process.chdir(__dirname)`，配置读 `.next/required-server-files.json`，所以
 * `next.config.js` 不需要随包）；`public/` 是静态资源（产物根已从 `public/generated`
 * 搬到仓库根的 `generated/`，它是默认拒绝的一项，见下面清单里那条注释）；`scripts/`
 * 是编排器与宿主的运行期脚本（内部再按 `ALLOWED_SCRIPTS` 逐文件判，放行目录不等于
 * 放行整棵）；`src` 不在任何一层，只有 `RUNTIME_SRC` 逐文件放行的例外。
 * static 多出那三项是**装配步**才产出的（`schema.sql` 现生成 DDL、两份 HTML 是壳的
 * 启动页与根路径兜底）。
 */
const STANDALONE_ALLOWED_TOPLEVEL = [
  ".next",
  "node_modules",
  "package.json",
  "public",
  "scripts",
  "server.js",
];

/** 桌包载荷层（`src-tauri/static`）的顶层白名单。 */
const STATIC_ALLOWED_TOPLEVEL = [
  ".next",
  "index.html",
  "node_modules",
  "package.json",
  "public",
  "schema.sql",
  "scripts",
  "server.js",
  "splash.html",
];

/**
 * `src/` 这一格走「顶层放行祖先、叶子逐文件判」的形态，理由与剔除侧的 `RUNTIME_SRC`
 * 同一条：`scripts/reap-process.mjs` 与 `scripts/dev-launcher.mjs` 都会
 * `await import("../src/lib/process/kill-process-tree.ts")`（硬规则 3）；
 * `scripts/launcher-core/shell.mjs` **静态** import
 * `../../src/lib/process/executable-resolve.ts`（ISSUE #1327，可执行形态判据的唯一实现）。
 * 与剔除侧同源，由用例核对（`tests/dist-artifact-hygiene.test.ts`）。
 */
const ALLOWED_SRC_FILES = [
  "lib/process/kill-process-tree.ts",
  "lib/process/executable-resolve.ts",
];

/** 该层允许的顶层条目。 */
function allowedTopLevelFor(label) {
  return label === "static" ? STATIC_ALLOWED_TOPLEVEL : STANDALONE_ALLOWED_TOPLEVEL;
}

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

/**
 * 宿主（COMFY_EXECUTOR=host）在产物里跑起来所必需的文件，**相对产物根**逐个点名。
 *
 * 与 REQUIRED_RUNTIME_FILES 同一类判据：缺件不在构建期报错，只在运行期表现为
 * 「设了 host 起不来」。本脚本查「有没有」，「起不起得来」由
 * scripts/smoke-executor-host-standalone.mjs 在 pnpm build 收尾真起一次进程验。
 * 两道都要，因为冒烟只跑 .next/standalone，而桌包组装（整树拷贝 + 剪枝）发生在
 * 冒烟之后，static 层没人再看第二眼。
 */
const REQUIRED_HOST_FILES = [
  "scripts/executor-host.mjs", // 进程外壳（env 解析 / 心跳 / 领取节拍）
  "scripts/executor-host.runtime.mjs", // 预编译运行时图（缺它 = 退回 tsx 分支 → boot FAILED）
  "scripts/executor-host.build.json", // 构建清单：inputs/externals，供门禁复算
];

/**
 * 桌包载荷（`src-tauri/static`，即 `bundle.resources` 装进安装包的那一份）的必备件。
 * 判据同 REQUIRED_HOST_FILES：缺件不在构建期报错，只在用户双击时表现为起不来。
 */
const REQUIRED_PAYLOAD_FILES = [
  // standalone 运行入口与它的环境装配（ISSUE #1216）：分发产物按硬规则 17 不含 .env，
  // 运行期配置只能由这份入口装配。
  "scripts/standalone-runtime.mjs",
  "scripts/launcher-core/standalone-runtime-env.mjs",
  // 首启建表的 DDL：载荷里没有 drizzle-kit，建表只能靠这份随包的 SQL。
  "schema.sql",
];

/**
 * 某条产物内相对路径在 `src/` 这一格里是否被允许（祖先放行、叶子逐文件判）。
 * 与剔除侧的 `RUNTIME_SRC` 同源；`rel` 形如 `src` / `src/lib` / `src/lib/…/x.ts`。
 */
function isAllowedSrcPath(rel) {
  if (rel === "src") return true;
  for (const allowed of ALLOWED_SRC_FILES) {
    const full = `src/${allowed}`;
    if (rel === full || full.startsWith(`${rel}/`)) return true;
  }
  return false;
}

/**
 * 数一份产物里的文件。
 *
 * `followLinks=false`（判「不该有的」用）：**不穿符号链接**。standalone 的
 * `node_modules/<pkg>` 是指向本仓库 pnpm store 的链接（实测 `node_modules/next`
 * 指向 `node_modules/.pnpm/next@…`），顺着链接数会把**开发机的依赖内容**记成产物
 * 内容（那 456 个 `next/dist/docs/*.md` 就是这么来的：产物里根本没有这些真文件，
 * 而剔除侧也不能顺链接删——那会损坏开发机依赖）。
 * `followLinks=true` 只在「必须有的」反向检查里用：运行时脚本经链接可达即算在位，
 * 这份产物本来就能跑起来。
 */
function listFiles(dir, prefix, out, followLinks, seen) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue; // 断链 / 读不到，跳过
    }
    if (st.isSymbolicLink()) {
      if (!followLinks) {
        out.push(rel); // 链接本身算一项产物内容，但不进去数它背后的真文件
        continue;
      }
      let realDir;
      try {
        realDir = fs.statSync(abs).isDirectory() ? fs.realpathSync(abs) : null;
      } catch {
        out.push(rel);
        continue;
      }
      if (!realDir) {
        out.push(rel);
        continue;
      }
      // 链接成环时（pnpm store 不会，但产物被人手工拼过就不能保证）seen 集合是
      // 唯一的止环判据：同一个真实目录只展开一次
      if (seen.has(realDir)) {
        out.push(rel);
        continue;
      }
      seen.add(realDir);
      listFiles(abs, rel, out, followLinks, seen);
      continue;
    }
    if (st.isDirectory()) {
      listFiles(abs, rel, out, followLinks, seen);
      continue;
    }
    out.push(rel);
  }
  return out;
}

/** 外层入口：`followLinks=false` 数产物自己的真内容，`true` 数「运行时可达的」。 */
function collectFiles(dir, followLinks) {
  return listFiles(dir, "", [], followLinks, new Set([dir]));
}

/**
 * 「必须有的」Next 运行时脚本缺件清单（纯查询，本脚本与用例共用）。
 *
 * 按**运行时可达**口径判：`node_modules/next` 在 standalone 里是指向 pnpm store 的链接，
 * 运行时经它照样 require 得到，所以判「必须有的」要穿链接数；用「真文件」口径会把它
 * 判成缺件（假红）。
 *
 * @param {string} dir 产物目录
 * @returns {string[]} 缺件（相对 `RUNTIME_DIR` 的文件名）
 */
function missingRequiredRuntimeFiles(dir) {
  const reachable = collectFiles(dir, true);
  return REQUIRED_RUNTIME_FILES.filter(
    (name) => !reachable.includes(`${RUNTIME_DIR}/${name}`),
  );
}

/**
 * 数一份产物的文件并做同一份禁忌清单检查。
 * @param {string} dir 产物目录
 * @param {string} label 输出前缀
 * @returns {boolean} 是否发现违规
 */
function checkDir(dir, label) {
  // 判「不该有的」只数产物自己的真内容（不穿链接）；判「必须有的」按运行时可达算，
  // 两处口径不同是刻意的，理由见 listFiles 的注释。
  const files = collectFiles(dir, false);
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
  //
  // **两层产物都查**（此前只查 standalone，是个真空档）：最终被编译期内嵌进 exe 的
  // 是 `src-tauri/static` 那一份，而 build-desktop 的整树拷贝（`dereference: true`）
  // 与剪枝全部发生在 standalone 那次检查**之后** —— 只查一层等于「构建期过了就当
  // 出厂件也在」。缺件在 exe 里的表现完全一样：页面正常、接口全 500。
  // 判据与宿主那条一致：只有这一层真的是个产物（有 `server.js`）才提缺件 ——
  // 开发机上 `src-tauri/static` 常只剩几个入库例外文件，对那种半成品目录报「缺件」
  // 只会把人指到错的地方。
  if (files.includes("server.js")) {
    const missingRuntime = missingRequiredRuntimeFiles(dir);
    if (missingRuntime.length > 0) {
      failed = true;
      console.error(
        `[${label}] Next 运行时脚本缺件 ${missingRuntime.length} 个：\n  ` +
          missingRuntime.join("\n  ") +
          "\n  后果是所有 App Route 返回 500（页面正常、接口全挂）。" +
          (label === "standalone"
            ? "请确认 next.config.js 的 outputFileTracingIncludes 仍在（§7.4）。"
            : "这一层是 build-desktop 组装出来的：先确认 `.next/standalone` 那层不缺" +
              "（缺则回到 outputFileTracingIncludes，§7.4），再确认组装时的拷贝/剪枝" +
              "没把它抹掉（`dereference: true` 那一步），然后重跑 pnpm tauri build。"),
      );
    }
  }
  if (strayScripts.length > 0) {
    failed = true;
    console.error(
      `[${label}] 内部门禁脚本不该进产物，却发现 ${strayScripts.length} 个：\n  ` +
        strayScripts.slice(0, 8).join("\n  ") +
        (strayScripts.length > 8
          ? `\n  …（其余 ${strayScripts.length - 8} 个省略）`
          : "") +
        "\n  （runtime 真的会读的脚本靠 ALLOWED_SCRIPTS 白名单保留；" +
        "新增脚本默认应被剔除，要保留请登记并说明理由）",
    );
  }
  // 宿主必需文件的反向检查（3-E1）。**两层产物都查**，但只在这一层真的是个产物时
  // （有 server.js）才提缺件：开发机上 src-tauri/static 常只剩一两个入库例外文件
  // （.gitignore 的 !/static/scripts/ 例外），对那种半成品目录报「缺件」只会让人
  // 去查错的地方。
  const missingHost = files.includes("server.js")
    ? REQUIRED_HOST_FILES.filter((p) => !files.includes(p))
    : [];
  if (missingHost.length > 0) {
    failed = true;
    console.error(
      `[${label}] 执行器宿主必需文件缺件 ${missingHost.length} 个：\n  ` +
        missingHost.join("\n  ") +
        "\n  后果：桌包/standalone 里设 COMFY_EXECUTOR=host 时宿主 boot 大声失败" +
        "（exit 1）——任务不会误跑，但也不会跑。\n  修法：先跑 pnpm build（收尾含 " +
        "node scripts/build-executor-host.mjs），再确认没被剪枝误删（白名单在 " +
        "standalone-private-inputs.mjs 的 RUNTIME_SCRIPTS）。",
    );
  }
  // 桌包载荷的必备件（ISSUE #1216）：**只查 static 这一层**——`schema.sql` 与运行入口
  // 都由装配步产出/从仓库显式拷贝，`.next/standalone` 那一层没有它们才是常态（入口是
  // 给壳用的，standalone 层由 pnpm build 的冒烟负责）。缺件的表现同样是「双击没反应 /
  // 窗口停在启动页」，构建期不数文件就没人知道。
  const missingPayload =
    label === "static" && files.includes("server.js")
      ? REQUIRED_PAYLOAD_FILES.filter((p) => !files.includes(p))
      : [];
  if (missingPayload.length > 0) {
    failed = true;
    console.error(
      `[${label}] 桌包载荷必备件缺件 ${missingPayload.length} 个：\n  ` +
        missingPayload.join("\n  ") +
        "\n  后果：standalone 形态下壳起不了 server（缺入口）或首启建不出表（缺 " +
        "schema.sql，表现是页面 200、接口全 500）。\n  修法：跑 node scripts/build-desktop.mjs" +
        "（§首启建表 导出 DDL、§10.2 同步运行期脚本），再确认没被 §装配 白名单剪掉。",
    );
  }
  /* ── 顶层默认拒绝（ISSUE #1217）─────────────────────────────────────
   * 方向与 FORBIDDEN 相反：那份黑名单**欠完备**，每多一个被 tracing 带进来的目录都要
   * 有人记得补一条，漏掉是静默的（`db.sqlite` 当年就是这么漏的）。这里改成「只允许
   * 运行时必需那几件，多一个就红」，让「凭空多一个顶层目录」必然被看见。
   *
   * 实测为什么必须这样：同一次构建走 Turbopack 时 `outputFileTracingExcludes` 对这些
   * 整目录条目**一条都不减**（40 个顶层条目 / 19274 个真文件，里面躺着 `src-tauri` 8520、
   * `python-venv` 5356、`db.sqlite`+WAL/SHM、`.env` 和仓库根那个 `Comfy APP.lnk`），
   * 而**跑完当时那套按名字的剔除清单之后仍然剩 19 个顶层条目**。规范 §7.2。
   * 换 webpack 也不是出路（§7.2 的 A/B 量过：webpack 下这些整目录条目确实归 0，
   * 但 `.env`、`data/`（含密钥）、`log/` 照旧进来，而运行时脚本清单点名的全是
   * `*-turbo.runtime.prod.js`）。
   *
   * 顶层条目按 `readdirSync(withFileTypes)` 数、**包括符号链接在内**：链接指向开发机目录，
   * 在「真文件」口径下它什么都不算，但它确实随包出去了。`src` 是例外——那格走
   * 「祖先放行、叶子逐文件判」，叶子在下一条里单独判。
   */
  const allowedTop = allowedTopLevelFor(label);
  const topEntries = fs
    .readdirSync(dir, { withFileTypes: true })
    .map((e) => e.name);
  const strayTop = topEntries.filter(
    (name) => name !== "src" && !allowedTop.includes(name),
  );
  if (strayTop.length > 0) {
    failed = true;
    console.error(
      `[${label}] 顶层出现白名单外的条目 ${strayTop.length} 个：\n  ` +
        strayTop.slice(0, 12).join("\n  ") +
        (strayTop.length > 12
          ? `\n  …（其余 ${strayTop.length - 12} 个省略）`
          : "") +
        `\n  允许的就这些：${allowedTop.join(" / ")}（外加逐文件放行的 src/）。` +
          "\n  新增一项必须**同批**改两处：剔除侧 `standalone-private-inputs.mjs` 与这里" +
          "（两份清单逐字同源，由 tests/dist-artifact-hygiene.test.ts 核对），并写清" +
          "「谁在运行期读它」——只补一处会得到「删掉了却仍判违规」或反过来。" +
          "\n  根因不在 excludes：规范 §7.2 实测 Turbopack 不读 outputFileTracingExcludes" +
          " 的整目录条目（webpack 那条链才读，而桌包运行时脚本清单点名的是 " +
          "`*-turbo.runtime.prod.js`，换构建器等于换整条产物链）。",
    );
  }
  // `src/` 的叶子逐文件判。只锚**产物根**那一份 `src/`：`node_modules/<pkg>/src/**` 是
  // 第三方包自己的源码，把它算成违规会让护栏变成噪声（与 FORBIDDEN 那批同一条理由）。
  const straySrcFiles = files.filter(
    (f) => f.startsWith("src/") && !isAllowedSrcPath(f),
  );
  if (straySrcFiles.length > 0) {
    failed = true;
    console.error(
      `[${label}] src/ 下出现未逐文件登记的条目 ${straySrcFiles.length} 个：\n  ` +
        straySrcFiles.slice(0, 8).join("\n  ") +
        (straySrcFiles.length > 8
          ? `\n  …（其余 ${straySrcFiles.length - 8} 个省略）`
          : "") +
        `\n  这一格是「祖先放行、叶子逐文件判」：允许的是 ${ALLOWED_SRC_FILES.join(" / ")}；` +
          "\n  运行期真要读别的源文件，请同批改剔除侧的 RUNTIME_SRC 与这里的 ALLOWED_SRC_FILES。",
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
      "\n[standalone] 按这两处的**职责**排查，别按顺序猜（规范 §7.2、§7.3）：" +
        "① `scripts/standalone-private-inputs.mjs` —— 减法只在这里发生：根级条目" +
        "（DEV_ARTIFACTS / PRIVATE_INPUTS）+ 递归形状（FORBIDDEN_SHAPES / PRIVATE_SHAPES），" +
        "剔除不穿符号链接；产物是 `pnpm build` 收尾剥的还是 build-desktop 组装后剥的，" +
        "决定于一层就查一层。② `next.config.js` 的 `outputFileTracingExcludes` 只是**意图" +
        "声明**（实测整目录条目一条都不减，键位还得在顶层——写在 `experimental` 下" +
        "一个字都不会被读），它拦不住任何东西，别靠补条目「修」这条红。" +
        "\n  若红的是「顶层出现白名单外的条目」（ISSUE #1217）：减法只发生在 ① 那一份，" +
        "去 `STANDALONE_ALLOWED_TOPLEVEL` / `STATIC_ALLOWED_TOPLEVEL` 与 ① 的对应清单里" +
        "**成对登记**；不要为了变绿往这里加一项 —— 先回答「谁在运行期读它」。",
    );
    return 1;
  }
  return 0;
}

/**
 * 只在「被当作脚本执行」时跑：被 `require` 时（`tests/dist-artifact-hygiene.test.ts`
 * 要把两份清单拿来**逐字比对**）绝不能顺手 `process.exit` —— 那会把测试进程带走，
 * 而「比对代码在、但一条都没真的比过」正是这类清单判据最难发现的失效形态。
 */
if (require.main === module) process.exit(main());

module.exports = {
  FORBIDDEN,
  ALLOWED_SCRIPTS,
  STANDALONE_ALLOWED_TOPLEVEL,
  STATIC_ALLOWED_TOPLEVEL,
  ALLOWED_SRC_FILES,
  allowedTopLevelFor,
  isAllowedSrcPath,
  REQUIRED_RUNTIME_FILES,
  REQUIRED_HOST_FILES,
  REQUIRED_PAYLOAD_FILES,
  RUNTIME_DIR,
  collectFiles,
  missingRequiredRuntimeFiles,
  checkDir,
};
