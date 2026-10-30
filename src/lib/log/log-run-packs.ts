/* ── 「启动日志」的**跨包**判据：一次运行一包里的各份启动日志 ────────────
 *
 * 设置页「启动日志」的下拉此前只列 `log/current/services/` 下该来源的份 ——
 * 也就是**本次运行**里这个服务被启动过几次。当前一包被归档进
 * `log/runs/<日期>_<时分秒>-<runId>/`、`current/` 被清空之后，那些份**没有任何
 * 界面能打开**（ISSUE #1326 用户原话：「保留跨包翻转」）。
 *
 * 本模块给出跨包那一层的**纯判据**：包目录名怎么解析、下拉项怎么排、文案怎么
 * 拼。读目录与 `run.json` 归 `log-run-packs.server.ts`（规范 18 §18.4 分层）。
 *
 * ## 与「一次启动一份文件」的关系（ISSUE #1326 的一条主线）
 *
 * #1537 把四份 runtime 日志改成**一次启动一份文件**之后，正文不再需要任何切分
 * 判据 —— 「文件是谁」不依赖任何假设。跨包这一层**复用的正是这条**：
 *
 *   - 一个包里的 `services/<来源>-<时刻>.log` 天生只属于那一次启动；
 *   - 于是「跨包翻」就是把各包里的**文件**排成一条时间线，不做任何长度减法。
 *
 * 与 #1520 那版（按运行包列表、正文减前一包）的区别就在这里：那版减法的基准
 * 是「包 N ⊇ 包 N-1」，随 #1537 一起退场；这里一条假设都不需要。
 *
 * ## 会话 id 的形态
 *
 * `current/` 里的份沿用**文件名**当 id（与「一次启动一份文件」那版一致）；
 * `runs/` 里的份必须带上包名，否则两个包里同名文件（同一秒内两次启动的
 * `-2`、迁移前的旧固定名）会撞成一个 id。因此归档份的 id 是
 * `<包名>/<文件名>`，判据见 {@link packScopedId} / {@link parsePackScopedId}。
 * 分隔符取 `/`：包名里不可能有它（它是目录名），文件名里也不可能有（它是
 * 单一文件名）—— 两侧都不含，拼起来就不可能歧义。
 */

import { compareText } from "~/lib/ordered-set";
import { formatClock, formatShortDate } from "~/lib/time-format";

import type { LogSessionMeta } from "./log-sessions";

/** 归档份 id 的分隔符（包名与文件名两侧都不含，见模块头）。 */
const PACK_SEP = "/";

/** 包目录名里的日期与时分秒（形态与 `run.mjs` 的 `runDirName` 同源）。 */
const PACK_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-([0-9a-f]+)$/;

/**
 * 运行包目录名 → 毫秒时刻（本地时区）；形态不符返回 null。
 *
 * 从**名字**读而不是用目录 mtime：归档是整目录复制，但外部拷贝、解压、保留
 * 策略都会让 mtime 变（`run.mjs` 的 `pruneRuns` 注释里写着这条）。名字里的时刻
 * 是写进去的、不随搬动变化。
 */
export function packNameToMs(name: string): number | null {
  const m = PACK_NAME_RE.exec(name);
  if (!m) return null;
  const value = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  ).getTime();
  return Number.isFinite(value) ? value : null;
}

/** 归档份的会话 id：`<包名>/<文件名>`。 */
export function packScopedId(packName: string, fileName: string): string {
  return `${packName}${PACK_SEP}${fileName}`;
}

/** 解析归档份 id（不是这个形态时返回 null —— `current/` 的份就是裸文件名）。 */
export function parsePackScopedId(id: string): { packName: string; fileName: string } | null {
  const at = id.indexOf(PACK_SEP);
  if (at <= 0) return null;
  const packName = id.slice(0, at);
  const fileName = id.slice(at + 1);
  /* 包名必须是**真实存在过的**包名形态：`dev-launcher.log` 这类裸文件名里也
   * 可能有 `/`？不会（文件名不含路径分隔符），但客户端缓存过一个畸形 id 时
   * 这里必须能判出来并回落，而不是拿它去拼路径。 */
  if (!PACK_NAME_RE.test(packName) || fileName.length === 0) return null;
  if (fileName.includes(PACK_SEP)) return null;
  return { packName, fileName };
}

/** `runs/` 里的一个运行包（读目录与 `run.json` 归 `log-run-packs.server.ts`）。 */
export interface RunPack {
  /** 目录名（`<日期>_<时分秒>-<runId>`），字典序即时间序。 */
  name: string;
  /** `run.json` 的 `startedAt`（毫秒）；读不到时退回名字里的时刻，再读不到为 null。 */
  startedAt: number | null;
  /** `run.json` 的 `crashed` —— 崩溃现场恰恰最值得看，界面上要标出来。 */
  crashed: boolean;
  /** 这一包里该来源的份（新→旧）；空数组 = 那次运行没启动过这个服务。 */
  files: Array<PackLogFile>;
}

/** 包内的一份启动日志。 */
export interface PackLogFile {
  /** 包内相对文件名（如 `comfyui-runtime-20261005-093612.log`）。 */
  name: string;
  /** 该份的启动时刻（毫秒）；迁移前的旧固定名读不出时刻，为 null。 */
  startedAt: number | null;
  /** 下拉文案的时刻段（调用方把它视作 `LogSessionMeta.title`）。 */
  title: string;
}

/** 下拉的一项：跨包之后每条都带「它属于哪一次运行」。 */
export interface RunScopedOption extends LogSessionMeta {
  /** `current` = 正在写的本次运行；`runs` = 已归档的历史包。 */
  scope: "current" | "runs";
  /** 该次运行异常退出（`run.json` 的 `crashed`）；`current` 恒为 false。 */
  crashed: boolean;
}

/**
 * 把「本次运行的份」与「各历史包里的份」拼成一条时间线（新→旧）。
 *
 * ## 顺序口径
 *
 * 先按**次运行**分组（本次在最前，历史包按名字倒序 = 时间倒序），每组里面再按
 * 份的时间倒序。不能把两边混成一条扁平的按时刻倒序：那会让「本次运行的第 1 次
 * 启动」夹在「上一包的第 3 次启动」与「上一包的第 2 次启动」之间 —— 用户是拿
 * 这个下拉**定位一次运行**（`run.json` 的 runId 是 `grep` 的入口、退出形态是
 * 「该不该看」的第一判据），分组语义比全局时刻序更有用。
 *
 * ## 本次运行恒在最前
 *
 * 即使它的时刻比某个历史包更早（时钟回拨、包名手改）也保持这个顺序：这一栏的
 * 语义是「正在写的这一次」，位置固定比时刻准确更重要 —— 用户按「最上面那一项」
 * 找到当下，是这条下拉最高频的用法。
 *
 * @param current `current/` 里该来源的份（旧→新，与 `listRuntimeLogFiles` 同序）
 * @param packs 历史包（新→旧）
 * @param max 列表条数上限（超出时取**最新**的那些）
 * @param total 该来源跨包一共有几份（不受 `max` 影响；界面据此说明被截断）
 */
export function buildRunScopedOptions(
  current: Array<PackLogFile>,
  packs: Array<RunPack>,
  max: number,
  total: number,
): { sessions: Array<RunScopedOption>; total: number } {
  const out: Array<RunScopedOption> = [];
  /* 本次运行：倒序（最新那次启动在最上面，与整条列表同向）。 */
  for (const file of current.slice().reverse()) {
    out.push({
      id: file.name,
      title: formatScopedLabel(file.title, "本次运行", null),
      startedAt: file.startedAt,
      scope: "current",
      crashed: false,
    });
  }
  for (const pack of packs) {
    const runId = stripRunId(pack.name);
    for (const file of pack.files) {
      out.push({
        id: packScopedId(pack.name, file.name),
        title: formatScopedLabel(file.title, exitText(pack.crashed), runId),
        startedAt: file.startedAt,
        scope: "runs",
        crashed: pack.crashed,
      });
    }
  }
  return { sessions: out.slice(0, Math.max(0, max)), total };
}

/**
 * 下拉文案：`09-30 19:36:12 · 正常退出 · a1b2c3`。
 *
 * 三段都是必要的，缺一个都会让用户挑错：
 *   - **日期 + 时刻**：同一次运行里多次启动的标题逐字相同，只有时刻能区分；
 *     历史包跨天，只给 `HH:mm:ss` 会让「昨天那次」与「今天那次」看起来一样；
 *   - **正常 / 异常退出**：崩溃那次的日志形态与正常退出完全不同（末尾是断的），
 *     先标出来用户才知道自己在看什么；
 *   - **runId**：它是 `grep <runId> log/current log/runs/` 的唯一入口
 *     （规范 §4.0 第三条使用姿势）。界面上不给，用户报问题时说不清是哪一次。
 *
 * `parts` 里空白段被跳过（旧固定名读不出时刻 → 只给后两段）；全空时回 `"—"`
 * 而不是空串 —— 空标题在下拉里是一行看不见的可点区域。
 */
export function formatScopedLabel(
  timePart: string,
  exitPart: string,
  runId: string | null,
): string {
  const parts = [timePart, exitPart, runId ?? ""].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** 归档目录名尾段的 runId（`…-a1b2c3` → `a1b2c3`）。 */
function stripRunId(packName: string): string | null {
  const dash = packName.lastIndexOf("-");
  return dash >= 0 ? packName.slice(dash + 1) : null;
}

/** 退出形态文案（`crashed` 只回答「崩没崩」，两个文案都在这里写一次）。 */
function exitText(crashed: boolean): string {
  return crashed ? "异常退出" : "正常退出";
}

/**
 * 一份文件的时刻 → 下拉文案的时刻段（`09-30 19:36:12`）。
 *
 * 与 `runtimeLogFileLabel` 同源的口径，但那里的入参是**解析结果**、
 * 这里的调用方手上只有 `startedAt`（归档份要从包里重新解析文件名）。合并两处
 * 会让 `runtime-log-file` 依赖「包」这个概念，而它本该对包一无所知。
 */
export function formatFileTime(startedAt: number | null): string {
  if (startedAt === null) return "更早的日志";
  return `${formatShortDate(startedAt)} ${formatClock(startedAt)}`;
}

/** 历史包排序：按**名字**升序（字典序 = 时间序，规范 §4.0 的设计）。
 *
 * 不用 `startedAt`：`.zip` 包或缺 `run.json` 时它是 null，而名字永远在。
 * 比较器走 `~/lib/ordered-set` 的唯一出口（§16.2.4.57 P51）。
 */
export function sortPackNames(names: Array<string>): Array<string> {
  return names.slice().sort(compareText);
}
