/* ── 设置页「启动日志」的数据契约（两端共用）────────────────────────────
 *
 * 这个模块**只剩契约**：`LogSessionMeta` 与 `LogSessionsPayload`。两端共用的
 * 类型写在一边（端点或客户端）必然出现「服务端改了字段、客户端还在按旧字段
 * 读」的静默漂移，因此它独立成一个叶子模块。
 *
 * ## 这里曾经有一整套「按文件内横幅切会话」的实现（ISSUE #1326 移除）
 *
 * 原实现（`parseLogSessions` / `formatSessionLabel` / `LogSessionChunk`）按
 * `log/current/services/*-runtime.log` 里的 `▶`/`■` 横幅把文件切成段落，让设置页
 * 的下拉能「切到第几次启动」。它解决的是**同一个文件里**的历史，而那份历史
 * 的可见性止于**应用退出**：
 *
 *   - 进程退出时启动编排把整个 `current/` 复制进
 *     `log/runs/<日期>_<时分秒>-<runId>/`，再清空 `current/`（规范 §4）；
 *   - 下一次启动时那个文件从**空**开始重新累积，`runs/` 里那一包**没有界面能
 *     打开** —— 用户原话「之前能切换的也是历史，不能用 runs 中找吗」。
 *
 * 跨运行那一层现在由 `log-run-sessions.ts` 承担（判据是**一次运行一包**：
 * 本次运行 + `runs/` 各历史包），端点列的是运行而不是横幅段落。于是原实现
 * 变成**零消费方的死代码** —— 留着它的代价不是行数，而是下一个人会以为
 * 「横幅切分」仍是有效口径（§12.15 第二条：写不出谁在什么时候用即删）。
 *
 * ## 横幅本身**没有**被移除
 *
 * `session-banner.server.ts` 照旧在写（`▶ ComfyUI 启动会话` 等）：它的价值是
 * **人直接打开文件时**看得出边界（一次运行里 ComfyUI 可能被启动/停止好几轮）。
 * 被移除的只是「服务端按它切会话」这条读取链 —— 写侧的判据与读侧的消费面是
 * 两件事，写侧的判据不该因为读侧换了口径就跟着消失。
 */

/** 下拉的一项（一次运行）。 */
export interface LogSessionMeta {
  /**
   * 运行标识：`run:<包目录名>`（历史包）或 `run:current`（本次运行）。
   *
   * 前缀 `run:` 让它与旧实现的行号 id 天然不冲突，也让端点能一眼分辨
   * 「这是运行包还是别的什么」（见 `log-run-sessions.packNameOf`）。
   */
  id: string;
  /** 下拉文案（由端点的 `formatRunLabel` 拼好：时刻 · 退出形态 · runId）。 */
  title: string;
  /** 该次运行的开始时刻（毫秒）；读不到为 null。 */
  startedAt: number | null;
}

/**
 * `GET /api/logs/sessions` 的响应体。
 *
 * 定义在这里而不是端点或客户端任一侧：它是**两端共用的契约**，写在一边就会
 * 出现「服务端改了字段、客户端还在按旧字段读」的静默漂移。
 */
export interface LogSessionsPayload {
  /**
   * 可选**运行**（新→旧，最新在最上面），已按上限裁剪。
   *
   * 列的是「一次运行一包」：本次运行（`current/`）＋ `runs/` 里各历史包。
   * 列表顺序由 `log-run-sessions.buildRunOptions()` 给（最新在前），
   * 不再是文件行序。
   */
  sessions: LogSessionMeta[];
  /** 本次返回的正文属于哪一项；没有可用会话时为 null。 */
  selectedId: string | null;
  /** 选中那一项的正文（可能被服务端的字符上限截断）。 */
  content: string;
  /** 正文被截断（界面据此提示只见最近一段）。 */
  truncated: boolean;
  /** 服务端只扫了尾部窗口 —— 前面还有没读到的内容。 */
  windowed: boolean;
  /** 该次运行对应文件的字节数（排障与页脚展示）。 */
  size: number;
  /**
   * 该次运行的正文前缀基准不可得 —— 正文里含**更早运行**的内容。
   *
   * 成因是保留策略删掉了它前面那一包（`runs/` 只留最近 20 次或 7 天），于是
   * 「当前包 − 前一包」这个减法没有基准可减。见 `log-run-sessions.ts` 的
   * `runSlice()`：那里选择**整份给出并说出来**，而不是猜一个基准把内容切掉。
   */
  baselineMissing: boolean;
}
