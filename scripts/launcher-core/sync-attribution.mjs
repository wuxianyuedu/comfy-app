#!/usr/bin/env node
// 陈旧路由表自愈的「懒归因」：把一次代码改动的清单翻成**一句人话**。
//
// 为什么需要它：运行期自愈（`dev-launcher.mjs` 的常驻探测）只说「重启了」，
// 用户还是不知道自己那次 `git pull` 到底动了什么、为什么接口层会整体 404。
// 归因不是判据——**判据是症状（页面 200 且 /api/health 404）**，归因只是通知
// 文案。因此它可以「懒」：只在**已经决定要自愈**那一刻跑一次 `git diff`，拿不到
// 就退化成「无法归因」，绝不影响自愈本身。
//
// 本模块**纯函数、无 IO**：git 的调用在 `runtime-heal.mjs`，这里只做
// 「一段 diff 文本 → 类目集合 → 一句话」。这样它可以逐分支单测，而 IO 侧另有
// 其用例。

/** `git diff --name-status -M` 的一行。 */
/**
 * @typedef {object} DiffEntry
 * @property {string} status 状态码首字母（A / M / D / R / C / T …）
 * @property {string} path 变化后的路径（R / C 取新路径）
 * @property {string} oldPath 重命名 / 复制时的旧路径；否则空串
 */

/** 归因判定的类目集合。 */
/**
 * @typedef {object} ClassifiedChanges
 * @property {{ added: number, removed: number, renamed: number, examples: string[] }} routes
 * @property {boolean} middleware 是否改了 `proxy.ts` / `middleware.ts`
 * @property {boolean} nextConfig 是否改了 `next.config.*`
 * @property {boolean} deps 是否改了依赖面（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）
 * @property {boolean} shell 是否改了桌面壳（src-tauri）
 * @property {number} other 其余文件的改动条数
 */

/** Next 的路由约定文件（只有它们的**增删**才改变路由表结构）。 */
const ROUTE_FILE_RE =
  /(?:^|\/)(?:route|page|layout|template|default|loading|error|not-found|global-error)\.(?:ts|tsx|js|jsx)$/;

/** 只有这几种状态码改变「路由表结构」；`M`（内容改动）不改结构。 */
const STRUCTURAL_STATUS = new Set(["A", "D", "R", "C"]);

/** 改变依赖面的文件名（与仓库里真正影响安装的三个文件同名）。 */
const DEP_FILES = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);

/** 中间件约定文件名：改了它们会改变所有请求的转发语义。 */
const MIDDLEWARE_FILES = new Set(["proxy.ts", "proxy.js", "middleware.ts", "middleware.js"]);

/** `next.config.*` 的判定（改了它可能改变输出 / 追踪 / 实验开关）。 */
const NEXT_CONFIG_RE = /(?:^|\/)next\.config\.(?:js|ts|mjs|cjs)$/;

/**
 * 解析 `git diff --name-status -M` 的输出。
 *
 * 形如（制表符分隔，一行一条）：
 *   `M\tpath`、`A\tpath`、`D\tpath`、`R100\told\tnew`、`C100\told\tnew`
 *
 * 读不懂的行**静默跳过**：归因是文案，宁可少说一句，也不能因为一行怪格式
 * 把整条自愈路径拖进异常。
 * @param {string} output @returns {DiffEntry[]}
 */
export function parseDiffEntries(output) {
  /** @type {DiffEntry[]} */
  const entries = [];
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- output 入参声明 string，调用方喂的是 git 子进程输出（可能为 null/undefined）
  for (const rawLine of String(output ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const parts = line.split("\t");
    const rawStatus = parts[0];
    const firstPath = parts[1];
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 无制表符的怪行 parts[1] 运行时为 undefined（git 输出是外部数据）
    if (rawStatus === undefined || firstPath === undefined) {
      continue;
    }
    const status = rawStatus.trim().charAt(0).toUpperCase();
    if (status === "") {
      continue;
    }
    if (parts.length >= 3) {
      const newPath = parts[2];
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- 上方长度闸已保证有值，守卫为 noUncheckedIndexedAccess 收窄
      if (newPath === undefined) {
        continue;
      }
      entries.push({ status, oldPath: firstPath, path: newPath });
    } else {
      entries.push({ status, oldPath: "", path: firstPath });
    }
  }
  return entries;
}

/** 取路径的末段（分类只需要文件名那一档）。 */
/** @param {string} filePath @returns {string} */
function baseName(filePath) {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}

/**
 * 把 diff 条目归类。
 *
 * 一个条目只归入**第一个**命中的类目（归因文案里同一件事说两遍没有意义）；
 * 都不命中才算进 `other`。
 * @param {DiffEntry[]} entries @returns {ClassifiedChanges}
 */
export function classifyChanges(entries) {
  /** @type {ClassifiedChanges["routes"]} */
  const routes = { added: 0, removed: 0, renamed: 0, examples: [] };
  let middleware = false;
  let nextConfig = false;
  let deps = false;
  let shell = false;
  let other = 0;

  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 导出函数入参防御：调用方运行时可传 null/undefined
  for (const entry of entries ?? []) {
    const { status, path, oldPath } = entry;
    const name = baseName(path);

    if (path.startsWith("src-tauri/")) {
      shell = true;
      continue;
    }
    if (DEP_FILES.has(name)) {
      deps = true;
      continue;
    }
    if (NEXT_CONFIG_RE.test(path)) {
      nextConfig = true;
      continue;
    }
    if (MIDDLEWARE_FILES.has(name)) {
      middleware = true;
      continue;
    }
    if (path.startsWith("src/app/") && ROUTE_FILE_RE.test(path)) {
      if (STRUCTURAL_STATUS.has(status)) {
        if (status === "A") {
          routes.added += 1;
        } else if (status === "D") {
          routes.removed += 1;
        } else {
          routes.renamed += 1;
        }
        if (routes.examples.length < 2) {
          routes.examples.push(oldPath === "" ? path : `${oldPath} → ${path}`);
        }
        continue;
      }
      // 路由文件的内容改动不改结构，计入「其余改动」。
      other += 1;
      continue;
    }
    other += 1;
  }

  return { routes, middleware, nextConfig, deps, shell, other };
}

/** 把类目集合说成一句人话（`headChanged === false` 时给「偶发失效」那句）。 */
/**
 * @param {ClassifiedChanges} classified
 * @param {{ headChanged: boolean }} facts
 * @returns {string}
 */
export function describeChanges(classified, facts) {
  if (!facts.headChanged) {
    return "未检测到代码改动，属偶发失效";
  }

  /** @type {string[]} */
  const parts = [];
  const { routes } = classified;
  if (routes.added + routes.removed + routes.renamed > 0) {
    const counts = [];
    if (routes.added > 0) {
      counts.push(`新增 ${routes.added}`);
    }
    if (routes.removed > 0) {
      counts.push(`删除 ${routes.removed}`);
    }
    if (routes.renamed > 0) {
      counts.push(`重命名 ${routes.renamed}`);
    }
    const example = routes.examples[0] ? `，如 ${routes.examples[0]}` : "";
    parts.push(`改了路由结构（${counts.join(" / ")}${example}）`);
  }
  if (classified.middleware) {
    parts.push("改了中间件（proxy.ts / middleware.ts）");
  }
  if (classified.nextConfig) {
    parts.push("改了 next.config");
  }
  if (classified.deps) {
    parts.push("改了依赖面（package.json / pnpm-lock.yaml）");
  }
  if (classified.shell) {
    parts.push("改了桌面壳（src-tauri）");
  }

  const tail = classified.other > 0 ? `；另有 ${classified.other} 个文件的常规改动` : "";

  if (parts.length === 0) {
    return `本次代码更新含 ${classified.other} 个文件的改动（未涉及路由结构 / 中间件 / 配置 / 依赖 / 壳）`;
  }
  return `本次代码更新${parts.join("、")}${tail}`;
}
