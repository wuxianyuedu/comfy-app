import { existsSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 构建期产出、不在仓库源码里的白名单条目（相对 scripts/）。
 *
 * scripts/build-desktop.mjs 拷 RUNTIME_SCRIPTS 时**跳过**这些名字（仓库里没有同名
 * 源文件，按缺件失败会把人引向「清单漂了」这个错方向），改在组装完整树之后断言它们
 * 还在——真正的故障是「忘了跑 pnpm build 里的那一步」或「被剪枝误删」。
 */
export const BUILT_RUNTIME_SCRIPTS = ["executor-host.runtime.mjs", "executor-host.build.json"];

/** 产物根下不该随分发包出去的开发文件（相对产物根）。 */
export const DEV_ARTIFACTS = [
  "AGENTS.md",
  "CHANGELOG-archive.md",
  "CHANGELOG.md",
  "README.md",
  "components.json",
  "drizzle.config.ts",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "prettier.config.js",
  "tsconfig.json",
  "typedoc.json",
  "vitest.config.ts",
  // TypeScript 增量编译缓存：构建期产物，不是运行时依赖
  "tsconfig.tsbuildinfo",
  "__pycache__",
  // 文档目录与变更碎片（都是产物根下的整目录，直接整删最省事）。
  // 「`.md` 不该随分发包出去」这条主张有两处判据在数：
  // `check-standalone-contents.cjs` 的 `["变更碎片"]`/`["文档目录"]` 两行，以及
  // `tests/turbopack-tracing-excludes.test.ts` 的同名产物探针。
  // `./docs/**`、`./changelog.d/**` 早就写在 `next.config.js` 的
  // outputFileTracingExcludes 里，**但实测对 tracing 带进来的文件不做减法**
  // （写在清单里的同一批目录，产物里仍有 747 个变更碎片真文件）——
  // 与 AGENTS 硬规则 17 记的 `.env` 是同一件事：兜底只能在这里显式删。
  "docs",
  "changelog.d",
  // `tools/docs/` 单列而不整删 `tools/`：后者该不该进产物是打包线的判断，
  // 这里只清无争议的文档。
  "tools/docs",
];

/**
 * 按**形状**递归剔除的条目（相对产物根的路径命中即删）。
 *
 * 为什么根级清单（DEV_ARTIFACTS）不够：这三类形状有相当一部分不在产物根，而是
 * 藏在解引用之后的依赖包里 —— `src-tauri/static`（最终被编译期内嵌进 exe 的那份）
 * 实测有 472 个 `node_modules/<pkg>/docs/` 下的 .md、24 个 `src/` 下的 .test.tsx，
 * 都不是「某个根目录」，列不进按目录名删的那张表。
 *
 * **判据必须与 `check-standalone-contents.cjs` 的 FORBIDDEN 同源**（这几条正则逐字
 * 相同，由 `tests/dist-artifact-hygiene.test.ts` 核对）：剔除侧与检查侧一旦漂移，
 * 表现是「删掉了却仍判违规」或「判违规却没人删」，两边都白跑。
 *
 * @type {Array<[string, RegExp]>}
 */
export const FORBIDDEN_SHAPES = [
  ["测试文件", /(?:^|\/)src\/.*\.test\.tsx?$/],
  ["变更碎片", /(?:^|\/)changelog\.d\/.*\.md$/],
  ["文档目录", /(?:^|\/)docs\/.*\.md$/],
];

/**
 * 密钥与开发库的**形状**（同样按产物根相对路径判，命中即删）。
 *
 * 为什么根级清单（PRIVATE_INPUTS）不够：那条只删产物根那层的
 * `.env` / `db.sqlite`，而全项目 tracing 会把藏在子目录里的开发库一起带进来
 * （实测 `check-standalone-contents.cjs` 在 `static` 上报出过旧布局下的 `db.sqlite`
 * 这一条 —— 判据早就写了「开发库文件绝不能出现」，减法却一直没人做）。
 * 表现不是多个文件，而是**上一台机器的数据成为出厂数据**。
 *
 * @type {Array<[string, RegExp]>}
 */
export const PRIVATE_SHAPES = [
  ["开发机私有输入", /(?:^|\/)\.env(?:\.[^/]*)?$/],
  ["开发库文件", /(?:^|\/)db\.sqlite(?:-wal|-shm)?$/],
];

/**
 * 剔除侧实际用的全集（形状级 + 密钥/开发库级）。
 *
 * @type {Array<[string, RegExp]>}
 */
const ALL_SHAPES = [...PRIVATE_SHAPES, ...FORBIDDEN_SHAPES];

/**
 * 递归剔除命中形状清单的文件，并收掉被掏空的目录。
 *
 * ⚠️ **不穿符号链接**（用 `lstatSync` 判类型、是链接就整条跳过）：
 * `.next/standalone/node_modules/<pkg>` 是指向本仓库 `node_modules/.pnpm/...`
 * 真 store 的链接（实测 `node_modules/next` 的链接目标就是开发机那份 Next），
 * 顺着链接删 `.md` 会**直接损坏开发机的依赖**，而不是清理产物。
 * 依赖包的内容真正变成产物里的真文件，是在 `build-desktop.mjs` 用
 * `dereference: true` 拷进 `static` 之后 —— 所以同一次剔除在 `staticDir` 上
 * 才会命中那 472 个文档；在 standalone 上命中的是 `src/` 下那些真文件。
 * 这条分工也是产物探针只信「真文件」的依据（见规范 §7.2）。
 *
 * @param {string} dir 产物目录（`.next/standalone` 或 `src-tauri/static`）
 * @param {(name: string) => void} [onRemoved] 每删一项的回调（用于日志）
 * @param {number} [reportLimit] 最多回调几条：这类文件成百，全打会淹掉构建输出，
 *   而**返回值不受它影响**（调用方要计数时拿到的是全量）
 * @returns {string[]} 实际删掉的相对路径
 */
export function stripForbiddenShapes(dir, onRemoved, reportLimit = Infinity) {
  /** @type {string[]} */
  const removed = [];
  pruneShapeWalk(dir, "", removed, onRemoved, reportLimit);
  return removed;
}

/**
 * 深度优先剔除；删空了的目录顺手收掉（空目录不参与模块解析，删它没有副作用）。
 *
 * @param {string} absDir 当前目录的绝对路径
 * @param {string} prefix 相对产物根的路径前缀（顶层调用传空串）
 * @param {string[]} removed 输出：实际删掉的相对路径（全量，不受 reportLimit 影响）
 * @param {((name: string) => void) | undefined} onRemoved
 * @param {number} reportLimit 只回调前这么多条（见 stripForbiddenShapes）
 */
function pruneShapeWalk(absDir, prefix, removed, onRemoved, reportLimit) {
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return; // 读不到的目录不是违规，跳过（断链 / 权限）
  }
  for (const name of names) {
    const abs = join(absDir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      continue;
    }
    if (st.isDirectory()) {
      pruneShapeWalk(abs, rel, removed, onRemoved, reportLimit);
      try {
        if (readdirSync(abs).length === 0) {
          rmSync(abs, { recursive: true, force: true });
        }
      } catch {
        /* 收不掉就留着：空目录无害，不值得为它把整趟剔除判成失败 */
      }
      continue;
    }
    if (!ALL_SHAPES.some(([, re]) => re.test(rel))) {
      continue;
    }
    rmSync(abs, { force: true });
    removed.push(rel);
    // 只回报名额内的几条：这类文件成百，全打会把构建输出淹掉
    if (removed.length <= reportLimit) {
      onRemoved?.(rel);
    }
  }
}

/**
 * 剔除开发期文件与内部门禁脚本（白名单保留 runtimeScripts）。
 *
 * @param {string} dir 产物目录（`.next/standalone` 或 `src-tauri/static`）
 * @param {((name: string) => void) | undefined} onRemoved 每删一项的回调（用于日志）
 * @param {string[]} runtimeScripts scripts/ 白名单（相对 scripts/）
 * @returns {string[]} 实际删掉的条目名
 */
export function stripDevArtifacts(dir, onRemoved, runtimeScripts) {
  const removed = [];
  for (const name of DEV_ARTIFACTS) {
    const p = join(dir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
      onRemoved?.(name);
    }
  }
  // scripts/：白名单之外一律剔除（新增脚本默认不进产物）。
  // 白名单条目允许是相对路径（如 `launcher-core/orchestrator.mjs`）：逐层比对，
  // 目录只有在「白名单里有它的子项」时才保留。
  const scriptsDir = join(dir, "scripts");
  if (existsSync(scriptsDir)) {
    pruneNotWhitelisted(scriptsDir, "", runtimeScripts, removed, onRemoved);
    // 全部被剔（未来 RUNTIME_SCRIPTS 变空）时不留空目录
    if (readdirSync(scriptsDir).length === 0) {
      rmSync(scriptsDir, { recursive: true, force: true });
    }
  }
  // 形状级剔除（测试文件 / 变更碎片 / 依赖包文档）。量大：实测 standalone 有
  // 406 个测试文件、static 有 472 个依赖包文档，逐条打日志会把构建输出淹掉，
  // 所以只点名前几条（走调用方的 onRemoved，它们是真实相对路径），
  // 分类计数作为返回值的一项汇总出现。
  const shapeRemoved = stripForbiddenShapes(dir, (rel) => onRemoved?.(rel), 5);
  if (shapeRemoved.length > 0) {
    const byTag = new Map();
    for (const rel of shapeRemoved) {
      const tag = ALL_SHAPES.find(([, re]) => re.test(rel))?.[0] ?? "其它";
      byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
    }
    removed.push(
      `形状剔除 ${shapeRemoved.length} 个（${[...byTag]
        .map(([tag, n]) => `${tag} ${n}`)
        .join(" / ")}）`,
    );
  }
  return removed;
}

/**
 * 按白名单剔除目录内的条目（支持 `a/b.mjs` 形式的相对路径）。
 *
 * 为什么白名单允许嵌套路径而不是「目录级放行」：目录级放行会让**以后新增**的
 * 脚本自动进产物 —— 而「新增脚本默认不进产物、要留下必须显式登记」正是这条
 * 白名单存在的全部意义。
 *
 * @param {string} absDir 当前扫描的绝对目录
 * @param {string} prefix 相对产物根的相对前缀（顶层调用传空串）
 * @param {string[]} allowed 白名单（相对 `scripts/` 的路径）
 * @param {string[]} removed 输出：实际删掉的条目（相对 `scripts/`）
 * @param {(name: string) => void} [onRemoved]
 */
function pruneNotWhitelisted(absDir, prefix, allowed, removed, onRemoved) {
  const direct = new Set();
  const nested = new Set();
  for (const rel of allowed) {
    if (prefix && !rel.startsWith(`${prefix}/`)) {
      continue;
    }
    const rest = prefix ? rel.slice(prefix.length + 1) : rel;
    const [head] = rest.split("/");
    if (!head) {
      continue;
    }
    direct.add(head);
    if (rest.includes("/")) {
      nested.add(head);
    }
  }
  for (const name of readdirSync(absDir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = join(absDir, name);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      /* 读不到时按需删除处理 */
    }
    if (isDir && direct.has(name) && nested.has(name)) {
      pruneNotWhitelisted(abs, rel, allowed, removed, onRemoved);
      continue;
    }
    if (!isDir && direct.has(name)) {
      continue;
    }
    if (isDir && nested.has(name)) {
      continue;
    }
    rmSync(abs, { recursive: true, force: true });
    removed.push(`scripts/${rel}`);
    onRemoved?.(`scripts/${rel}`);
  }
}
