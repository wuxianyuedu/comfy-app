/**
 * doc-reading-map.mjs —— `AGENTS.md`「强制先读规范文档的改动范围」那张表的**机器可读副本**（ISSUE #2765）。
 *
 * 那张表此前只有人眼能用：键是路径模式、值是散文式的章节引用，于是「这次改动该读哪一节」
 * 只能靠记忆或逐行比对。本模块把同一张表收成数据，让 `pnpm gates:which` 能按改动面直接
 * 匹配出该读的章节。
 *
 * ── 两份副本怎么不漂 ─────────────────────────────────────────────────────
 *
 * 权威的人读面仍是 `AGENTS.md` 那张表；本文件是它的**同一份事实**。两边由
 * `tests/gates-which.test.ts` 双向核对：表里出现的范围名必须在这里有、这里登记的
 * 范围名也必须在表里，且每行的章节引用要是表里那一格的子串 —— 改一边忘另一边当场红
 * （同 `INCREMENTAL_GATES` ⇄ `.cnb.yml` 的守法和理由）。
 *
 * ── 两种行 ─────────────────────────────────────────────────────────────
 *
 *   · **路径行**：`paths` 非空，按改动路径匹配（glob 复用 `fixed-gate-input-faces.mjs`
 *     的 `faceMatches`，不另写一份通配语义）；
 *   · **动作行**：`paths` 为空 —— 那张表里有两条判的是「你在做什么」而不是「你改了哪个
 *     文件」（新增视图层 IO、抽共享模块）。它们匹配不出来，所以在输出里单列一段，
 *     不许因为「按路径没命中」就静默消失。
 *
 * 本模块只被查询入口读，**不参与任何门禁判定**。
 */
import { faceMatches } from "./fixed-gate-input-faces.mjs";

/**
 * 一条登记。
 *
 * @typedef {{
 *   scope: string,
 *   paths: readonly string[],
 *   when?: string,
 *   spec: string,
 *   doc: string,
 * }} DocReading
 */

/** @type {ReadonlyArray<DocReading>} */
export const DOC_READING_MAP = [
  {
    scope: "启动链路",
    paths: [
      "scripts/dev-launcher.mjs",
      "scripts/dev-launcher.ps1",
      "scripts/launcher-core/**",
      "src-tauri/src/shell_launch.rs",
    ],
    spec: "§1–§3（编排 §3.3 / 入口 §3.2）",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "Windows 双击入口",
    paths: ["tools/**", "scripts/entry-common.ps1"],
    when: "新增 / 改动 tools/ 下的 .ps1 入口时",
    spec: "§8",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "Tauri 壳",
    paths: ["src-tauri/**"],
    spec: "§2、§7",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "ComfyUI 生命周期",
    paths: ["src/lib/comfyui/**"],
    spec: "§3、§5",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "工坊管线",
    paths: ["src/components/workshop/**", "src/lib/workshop/**"],
    spec: "§5",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "UI/逻辑分离",
    paths: [],
    when: "视图层新增 fetch / vanillaApi / tRPC hook 时",
    spec: "§17",
    doc: "docs/standards/17-UI与逻辑分离.md",
  },
  {
    scope: "lib 层边界与门禁",
    paths: ["src/lib/**"],
    when: "新增 / 移动模块、拆 `.server.ts`、共享类型给视图层时",
    spec: "§18",
    doc: "docs/standards/18-lib层规范.md",
  },
  {
    scope: "lib 子域归属",
    paths: ["src/lib/**"],
    when: "新增模块 / 新建子域目录 / 搬目录时",
    spec: "§12.5.3 + §18.12",
    doc: "docs/standards/12-代码组织与文件结构.md",
  },
  {
    scope: "跨平台动作",
    paths: ["package.json", "tools/**", "scripts/*.ps1", "scripts/*.mjs"],
    when: "新增 / 删除 .ps1 或 .mjs 入口、改 package.json 脚本时",
    spec: "§9.5",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "跨平台行为 / 端口与文档",
    paths: [
      "src/lib/process/kill-process-tree.ts",
      "src/lib/process/launch-path.ts",
      "scripts/app-port.mjs",
      "src-tauri/**",
    ],
    when: "新增按平台分叉的逻辑、在文档 / README 里写具体端口号时",
    spec: "§1.1、§3.1、§3.3、§9",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "构建与打包",
    paths: ["scripts/build-desktop.mjs", "tools/**"],
    spec: "§7、§8",
    doc: "docs/standards/launch-and-build.md",
  },
  {
    scope: "复用/去重与常量收口",
    paths: [],
    when: "抽共享模块、加改默认地址与端口、写新的质量门禁、同一串手工命令敲到第二次时",
    spec: "§12.18、§12.20、§12.12、§12.13、§12.14",
    doc: "docs/standards/12-代码组织与文件结构.md",
  },
  {
    scope: "提交 / PR / 合并这条流程本身",
    paths: ["scripts/ship*.mjs", ".cnb.yml", ".qoder/skills/ship/SKILL.md"],
    spec: "§13.6、§13.5.25、§13.10、§13.6.5",
    doc: "docs/standards/13-提交与-code-review.md",
  },
];

/**
 * 某个改动路径命中了一行登记吗。
 *
 * @param {DocReading} entry
 * @param {string} file
 * @returns {boolean}
 */
function hits(entry, file) {
  return entry.paths.some((p) => faceMatches(file, p));
}

/**
 * 按改动面匹配该读的章节。
 *
 * @param {Iterable<string>} changed 仓库相对路径（三种分隔符都归一成正斜杠）
 * @returns {{matched: DocReading[], actionOnly: DocReading[]}}
 *   `matched` 是碰到的路径行；`actionOnly` 是那两条「按动作判断」的行 —— 它们
 *   永远匹配不出来，所以调用点要把它们**显式印出来**，不能静默略过。
 */
export function matchDocReading(changed) {
  const files = [...changed].map((f) => String(f).replaceAll("\\", "/"));
  const matched = [];
  const actionOnly = [];
  for (const entry of DOC_READING_MAP) {
    if (entry.paths.length === 0) {
      actionOnly.push(entry);
      continue;
    }
    if (files.some((f) => hits(entry, f))) {
      matched.push(entry);
    }
  }
  return { matched, actionOnly };
}
