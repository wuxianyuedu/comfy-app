/* ── 消息中心按「每一次启动」分组（规范 17 §17.2 第①层，纯函数无 IO）─────────
 *
 * 手验反馈：消息中心里**多次启动的记录混在了一起**——断开 / 恢复 / 启动一条条
 * 平铺，18:41 那次与 18:14 那次之间没有任何分隔，用户读不出「这几条是同一次
 * 启动里发生的」。而这个面板记的恰恰是故障，分不清批次等于分不清故障次数。
 *
 * ## 分组键为什么是 runId 而不是 bootId / 时间
 *
 * · **不是 bootId**：整页刷新不换 dev server 进程，却会让 bootId 的对比基准
 *   失效；拿它分组会把「用户按了一次 Ctrl+R」也记成一次启动。
 * · **不是时间邻近**：同一次启动里可能隔很久才出第二条消息（断开后用户半天才
 *   重启），而相邻两次启动可能只差几秒（起来就崩）。时间猜不出批次。
 * · **是 runId**：launcher 在拉起服务之前单点生成、透传给同一次启动的所有子
 *   进程（见 `~/lib/shell/dev-server-id` 的 `getServerRunId`），一次启动一个值，
 *   与 `log/runs/<日期>_<时分秒>-<runId>`、`run/app-service-exit.json` 的 runId
 *   字段同源——分组头带上它，用户能直接拿去和日志目录对号。
 *
 * ## 归组规则：**连续**相同 runId 算一组
 *
 * 消息按时间倒序存放（store 的约定），于是同一次启动的消息天然相邻。判「连续」
 * 而不是「相同」还有一层好处：万一两个不同启动拿到同一个 runId（launcher 的
 * 6 位十六进制碰撞，概率约 1/16.7M），它们会被分成两组而不是并成一组——
 * 分组键碰撞的后果是「两次故障显示成一次」，比多一个组头糟得多。
 *
 * ## 读不到 runId 的消息怎么办
 *
 * 单独成组、标「未标记启动」，**不**并进相邻组：并进去等于断言「它属于那一次
 * 启动」，而这是一个不知道的事实（升级前写入的历史消息、纯手工 `pnpm dev`、
 * 没走 launcher 的链路都属于这一类）。
 */

/** 参与分组的最小形状。刻意不 import 组件层的 `MessageRecord`：
 *  `src/lib/**` 不得依赖 `src/components/**`（eslint boundaries 的 H1），
 *  而分组这件事本身只需要「谁 + 哪一次启动 + 什么时候」。 */
export type RunScopedMessage = {
  /** 消息 id（分组不改写它，只是原样带过去）。 */
  id: string;
  /** 属于哪一次启动；null = 写入时不知道。 */
  runId: string | null;
  /** Unix 毫秒。 */
  time: number;
};

/** 一组消息 = 一次启动（或「未标记」那一组）。 */
export type MessageRunGroup<T extends RunScopedMessage> = {
  /** 组内条数（= `messages.length`，单列一个字段是为了视图不用再数）。 */
  count: number;
  /** 是否正是**当前**这一次启动（`currentRunId` 命中的那一组）。 */
  isCurrent: boolean;
  /** 组头的语义文案（本次启动 / 上一次启动 / 更早的启动 / 未标记启动）。
   *  只给「该说哪几个字」，时间与条数由视图拼——判据与排版各管一段。 */
  label: string;
  /** 组内最新一条的时刻（组头「这一次启动发生在什么时候」用它）。 */
  latestAt: number;
  /** 组内消息，保持传入顺序（调用方传的是最新在前）。 */
  messages: Array<T>;
  /** 组键：这一次启动的 runId；null = 未标记启动。 */
  runId: string | null;
};

/** 「本次启动」——当前这一次，用户正身处其中。 */
const LABEL_CURRENT = "本次启动";
/** 紧邻当前组之前的那一次。 */
const LABEL_PREVIOUS = "上一次启动";
/** 更早的批次（时间戳负责把它们区分开）。 */
const LABEL_EARLIER = "更早的启动";
/** 写入时不知道属于哪一次启动（历史消息 / 手工 pnpm dev）。 */
const LABEL_UNMARKED = "未标记启动";

/** 内部草稿：定完 label 再交出去，避免把「先占位再回填」的半成品暴露给调用方。 */
type Draft<T extends RunScopedMessage> = {
  isCurrent: boolean;
  latestAt: number;
  messages: Array<T>;
  runId: string | null;
};

/**
 * 把消息按「每一次启动」分组。
 *
 * @param messages 已按时间**倒序**（最新在前）的消息——store 的存放约定。
 * @param currentRunId 当前是哪一次启动；null = 不知道（于是没有「本次启动」那一组）。
 * @returns 分组，顺序与输入一致（最新的组在前）。
 */
export function groupMessagesByRun<T extends RunScopedMessage>(
  messages: ReadonlyArray<T>,
  currentRunId: string | null,
): Array<MessageRunGroup<T>> {
  const drafts: Array<Draft<T>> = [];
  for (const m of messages) {
    const last = drafts[drafts.length - 1];
    /* 连续同一个 runId → 归进上一组。`last.runId === m.runId` 对两个 null 也成立，
     * 于是所有未标记的消息自然并成一组（它们本来也无法再分）。 */
    if (last?.runId === m.runId) {
      last.messages.push(m);
      /* 取 max 而不是「第一条即最新」：输入若因某种原因不完全有序，组头的时间
       * 仍然是组内真实的最新时刻，不会指向中间某条。 */
      last.latestAt = Math.max(last.latestAt, m.time);
      continue;
    }
    drafts.push({
      isCurrent: m.runId !== null && m.runId === currentRunId,
      latestAt: m.time,
      messages: [m],
      runId: m.runId,
    });
  }

  /* 第二趟才定 label：「上一次 / 更早」是相对整份名单的判断，看到第一个非当前组
   * 之前无法下结论。 */
  let seenNonCurrent = false;
  return drafts.map((d) => {
    const label = d.isCurrent
      ? LABEL_CURRENT
      : d.runId === null
        ? LABEL_UNMARKED
        : seenNonCurrent
          ? LABEL_EARLIER
          : LABEL_PREVIOUS;
    if (!d.isCurrent) {
      seenNonCurrent = true;
    }
    return {
      count: d.messages.length,
      isCurrent: d.isCurrent,
      label,
      latestAt: d.latestAt,
      messages: d.messages,
      runId: d.runId,
    };
  });
}
