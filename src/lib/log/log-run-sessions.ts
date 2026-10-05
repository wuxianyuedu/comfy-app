/* ── 「启动日志」的**跨运行**切分：一次运行一包（ISSUE #1326）────────────
 *
 * 设置页「启动日志」此前只有一种「历史」：`log/current/services/*-runtime.log`
 * 里被 `▶` 横幅切开的段落（见 `log-sessions.ts`）。那些文件**追加不轮转**，
 * 多个段落确实并存 —— 但它们的可见性止于**应用退出**：
 *
 *   - 进程退出时启动编排把整个 `current/` 复制进
 *     `log/runs/<日期>_<时分秒>-<runId>/`，再清空 `current/`（规范 §4）；
 *   - 下一次启动时那个文件从**空**开始重新累积，`runs/` 里那一包**没有任何
 *     界面能打开**。
 *
 * 于是「复盘历史去 `runs/` 一次一包」这条使用姿势只对翻文件系统的人成立，
 * 界面上没有出口（ISSUE #1326 用户原话：「之前能切换的也是历史，不能用 runs
 * 中找吗」）。本模块给出**跨运行**那一层的纯判据：下拉列哪些项、每项的正文
 * 取哪一段。
 *
 * ## 为什么正文要「减去前一包」（这是与「一次运行一包」的正面对撞）
 *
 * 那几份 runtime 日志**追加不轮转**，而归档是「整目录**复制**」。所以包 N 里
 * 那份文件 ⊇ 包 N-1 里那份，逐字节前缀关系。直接整份当「第 N 次运行」显示，
 * 用户点开「上一次」看到的是**从装应用那天起的全部输出** —— 与现在分不清哪次
 * 是哪次是同一个毛病。剪掉前一份的长度，剩下的才是本次真正多写了什么。
 *
 * 判据取**字节长度**而不是内容比对：前缀关系由「复制」语义保证，长度相减就是
 * 新增量；真去逐字节比等于把几 MB 读两遍，而结论完全一致。
 *
 * 基准**缺失**（该包是 `runs/` 里最早的一包，或它前面那包已被保留策略清掉）时
 * 如实退化成整份并标记出来 —— 见 {@link runSlice}。
 *
 * ## 分层（规范 18 §18.4）
 *
 * 纯函数，不碰文件系统：读目录、读文件长度归 `GET /api/logs/sessions` 的 IO 层。
 * 理由与 `log-sessions.ts` / `log-session-scope.ts` 同源 —— 判据要能脱离磁盘
 * 单测，而「哪一段属于哪次运行」只与两份文件的长短有关，与磁盘无关。
 */

import { compareText } from "~/lib/ordered-set";
import { formatClock, formatShortDate } from "~/lib/time-format";
import type { LogSessionMeta } from "./log-sessions";

/** 会话 id 前缀：运行包（跨运行）与 `log-sessions` 的行号 id 天然不冲突。 */
const RUN_ID_PREFIX = "run:";

/**
 * `runs/` 里的一个运行包（读目录与 `run.json` 归调用方）。
 *
 * 只带判据真正用到的字段 —— 完整 `run.json`（版本 / 分支 / commit / 各 pid）
 * 是「打包诊断」那一侧的消费面，这里多放几个字段会诱使视图去读它，
 * 而那几个字段在界面上没有位置（§12.15 第二条：写不出谁在什么时候用即不留）。
 */
export interface RunPack {
  /** 目录名（`<YYYY>-<MM>-<DD>_<HHmmss>-<runId>`），字典序即时间序。 */
  name: string;
  /** `run.json` 的 `startedAt`（毫秒）；无 `run.json`（含 `.zip` 包）时为 null。 */
  startedAt: number | null;
  /** `run.json` 的 `crashed` —— 崩溃现场恰恰最值得看，界面上要标出来。 */
  crashed: boolean;
  /** 这个包里有本次要读的来源文件（没有 = 那次运行没启动过这个服务）。 */
  hasSource: boolean;
}

/** 下拉的一项：一次运行（本次，或历史某一包）。 */
export interface RuntimeLogRunOption extends LogSessionMeta {
  /** `current` = 正在写的本次运行；`runs` = 已归档的历史包。 */
  scope: "current" | "runs";
  /** 该次运行异常退出（`run.json` 的 `crashed`）。 */
  crashed: boolean;
}

/** 「某项的正文该从第几字节开始」的裁决结果。 */
export interface RunSlice {
  /** 正文起点偏移（相对该文件开头）。 */
  from: number;
  /** 基准不可得或前缀关系不成立 —— 正文含更早运行的内容，界面要说明。 */
  baselineMissing: boolean;
}

/**
 * 裁决一个运行包的正文切片：`当前包该文件长度 − 前一份基准长度`。
 *
 * **基准不可得时整份给出去，不做任何猜测**：猜错的方向是「把别次运行的内容
 * 切掉」，那比多显示更糟 —— 用户会以为自己那次什么都没输出。因此这时返回
 * `{ from: 0, baselineMissing: false }`：多显示的历史内容由上一级的
 * 「文件里有更早的运行」提示承担，而不是在这里用一个假基准去切。
 *
 * 基准**比当前还长**说明前缀关系不成立（包被单独改动 / 基准取错了），这时
 * 同样整份给出，但标记 `baselineMissing: true` —— 这是「哪里不对」的信号，
 * 不能与「本来就没有基准」混成同一个状态。
 *
 * @param currentSize 当前包内该来源文件的字节数
 * @param baselineSize 前一份基准的字节数；null/undefined = 基准不可得
 */
export function runSlice(
  currentSize: number,
  baselineSize: number | null | undefined,
): RunSlice {
  if (baselineSize == null || !Number.isFinite(baselineSize)) {
    return { from: 0, baselineMissing: false };
  }
  if (baselineSize <= 0) return { from: 0, baselineMissing: false };
  if (baselineSize >= currentSize) return { from: 0, baselineMissing: true };
  return { from: baselineSize, baselineMissing: false };
}

/** 运行包目录名里的日期与时分秒（形态见 `run.mjs` 的 `runDirName`）。 */
const PACK_NAME_RE =
  /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})-([0-9a-f]{6})$/;

/**
 * 运行包目录名 → 毫秒时刻（本地时区）；形态不符返回 null。
 *
 * 从**名字**读而不是用目录 mtime：归档是「复制」，但外部拷贝、解压、保留策略
 * 都会让 mtime 变（`run.mjs` 的 `pruneRuns` 注释里就写着这条）。名字里的时刻
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

/** 由包目录名拼会话 id（与 `log-sessions` 的行号 id 不会撞）。 */
export function runPackId(packName: string): string {
  return `${RUN_ID_PREFIX}${packName}`;
}

/** 会话 id 是不是「运行包」形态。 */
export function isRunPackId(id: string): boolean {
  return id.startsWith(RUN_ID_PREFIX);
}

/** 会话 id → 包目录名（非本形态返回 null）。 */
export function packNameOf(id: string): string | null {
  return isRunPackId(id) ? id.slice(RUN_ID_PREFIX.length) : null;
}

/**
 * 运行包 → 下拉选项。
 *
 * 文案口径：`09-30 19:36:12 · 正常退出 · a1b2c3`，本次那项标 `本次运行`。
 *
 * 三处都是必要的，缺一个都会让用户挑错：
 *   - **日期 + 时刻**：同一次运行的标题逐字相同，只有时刻能区分（与
 *     `log-sessions.formatSessionLabel` 同一条理由）；历史包跨天，只给
 *     `HH:mm:ss` 会让「昨天那次」与「今天那次」看起来一样；
 *   - **正常 / 异常退出**：崩溃那次的日志形态与正常退出完全不同（没有退出
 *     横幅、末尾是断的），先标出来用户才知道自己在看什么；
 *   - **runId**：它是 `grep <runId> log/current log/runs/` 的唯一入口
 *     （规范 §4.0 第三条使用姿势）。界面上不给，用户报问题时说不清是哪一次。
 */
export function formatRunLabel(run: RuntimeLogRunOption): string {
  const parts: string[] = [];
  if (run.startedAt !== null) {
    parts.push(
      `${formatShortDate(run.startedAt)} ${formatClock(run.startedAt)}`,
    );
  }
  parts.push(run.scope === "current" ? "本次运行" : exitedText(run.crashed));
  const runId = packNameOf(run.id);
  if (runId) parts.push(stripRunId(runId));
  return parts.join(" · ");
}

/** 归档目录名尾段的 6 位 runId（`…-a1b2c3` → `a1b2c3`）。 */
function stripRunId(packName: string): string {
  const dash = packName.lastIndexOf("-");
  return dash >= 0 ? packName.slice(dash + 1) : packName;
}

/** 退出形态文案（`crashed` 只回答「崩没崩」，两个文案都在这里写一次）。 */
function exitedText(crashed: boolean): string {
  return crashed ? "异常退出" : "正常退出";
}

/**
 * 按「本次在前、历史按时间倒序」排下拉并编号 id。
 *
 * 顺序与 `log-sessions` 的会话列表**相反**（那里是文件行序 = 旧→新，最后一项
 * 最新）。这一层刻意「最新在最上面」：历史包可能有十几个，用户几乎总是要找
 * **最近**那几次，「最新的要翻到底」正是那套旧列表的毛病。差别写在这里，而不是
 * 让调用方各自 `reverse()` —— 那会变成两处分别记得（或分别忘了）的约定。
 *
 * 排序用**名字**而不是 `startedAt`：目录名里就带日期与时分秒且字典序 = 时间序
 * （规范 §4.0 的设计），而 `startedAt` 在 `.zip` 包或缺 `run.json` 时为 null。
 */
export function buildRunOptions(
  current: RuntimeLogRunOption | null,
  packs: RunPack[],
): RuntimeLogRunOption[] {
  const history = packs
    .slice()
    .sort((a, b) => compareText(a.name, b.name))
    .reverse()
    .map((pack) => ({
      id: runPackId(pack.name),
      /* 展示用的时刻取 `run.json` 的 `startedAt`，读不到时退回名字里那个
       * （两者都是那次运行的启动时刻，`run.json` 的更准）。 */
      startedAt: pack.startedAt ?? packNameToMs(pack.name),
      /* 标题由 `formatRunLabel` 统一给：`LogSessionMeta.title` 在两套来源里含义
       * 不同（横幅切分那套是横幅文字），留空以免视图误读。 */
      title: "",
      scope: "runs" as const,
      crashed: pack.crashed,
    }));
  return current ? [current, ...history] : history;
}
