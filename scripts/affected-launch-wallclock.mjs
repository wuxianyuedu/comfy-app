/**
 * `affected-launch-wallclock.mjs` —— 「这一格还剩多少墙钟」与「还开不开下一遍」的判点
 * （ISSUE #2364，规范 §13.6.4）。
 *
 * ── 为什么要有它 ─────────────────────────────────────────────────────────
 *
 * 组 C 那条判决链**只有等待预算**（`RETRY_BUDGET_MS`，#1747 之后收成整次一份），
 * 「跑」这件事从来没有上界。于是一次负载膨胀会把重试本身变成消耗：
 *
 * | 段 | 实测（build `cnb-q1c-1k5ora37n`，PR #2348） | 当时给没给结论 |
 * | -- | -- | -- |
 * | 第 1 遍（98 份 / 2 worker） | 9.2 分钟，6 条 `Test timed out in 30000ms` | 红（超时形态） |
 * | 第 2 遍（串行，只跑失败那两份） | 13.6 分钟 | 红 —— **换了一份文件** |
 * | 第 3 遍（逐文件补跑） | 31.1 分钟，整段无输出 | **没跑完** |
 * | 平台那一刀 | 3240105ms ≈ 54.0 分钟（`timeout of 3240000ms exceeded` / `ECONNABORTED`） | 那一格正文只剩 2 行 |
 *
 * 也就是说：这一格连一份结论都没留下 —— 而 `runChunk` 的退码表里明明写着
 * 「未判定 ⇒ 退 2 并点名」。所以本件不新增任何判定，只是让那句**有机会被说出来**：
 * 预算不够就不开下一遍，当场按「未判定」收尾。
 *
 * ── 判点放在「开下一遍之前」，不在跑中途 kill ────────────────────────────
 *
 * 中途 kill 会把一份**可能已经出来**的读数一起丢掉（第 2 遍跑到 90% 时那份真红的
 * 结论也没了）。这里要买的只是「别用第三遍去赌一个本来就不会有的结论」，
 * 所以每一遍一旦开跑就让它跑完，界只划在**要不要再开一遍**。
 *
 * ── 边界（这一格不做什么）───────────────────────────────────────────────
 *
 *   · **不动任何预算档**：`testTimeout` / `hookTimeout` / `maxWorkers` 一个字不改。
 *     §11.13 那句「争用**不构成**抬预算的理由」在这里照样成立 —— 本件改的是
 *     「还开不开下一遍」，不是「一条用例可以慢多久」。
 *   · **不把「没测」写成「通过」**：预算不够 ⇒ **未判定**，与 #2225 那档
 *     `unattributed` 同一个退码 `2`；它**不是**「未校验」（那是两次测量都只给超时指纹，
 *     退 0）。把这两档混起来就等于给「静默通过」开了一条新路。
 *   · **不从 `.cnb.yml` 那个 `timeout: 45m` 推界**：那一跑实测跑到 54.0 分钟才被掐，
 *     声明没有承重（那件事另有一单在跟）。这里的下界全部对着**实际掐点**算，
 *     并由用例钉住「预算 < 掐点」。
 *
 * 纯函数：不读盘、不起进程、不自己读时钟（`nowMs` / `startMs` 都是入参，缺省才落
 * `Date.now()`），所以每一档都能被用例逐字钉住。
 */

/**
 * 平台那一刀的实测落点（毫秒）。
 *
 * 出处：build `cnb-q1c-1k5ora37n` 的 `受影响用例` —— 平台给的原因原文
 * `timeout of 3240000ms exceeded`，回读到的该格 `duration` 是 3240105ms。
 * 这是一个**外部量纲**（不是本仓算出来的），所以它只用来当上界，不用来推预算。
 */
export const PLATFORM_STAGE_KILL_MS = 3_240_000;

/**
 * 这一格自设的墙钟预算（毫秒）。
 *
 * 取数：要覆盖「第 1 遍 + 第 2 遍」的正常最坏形状（实测 9.2 + 13.6 = 22.8 分钟），
 * 又要明显低于实际掐点 54.0 分钟 —— 25 分钟落在这两者之间，且给收尾（`BeforeEnd`
 * 那类）留出余量。**它比掐点小的那一条由用例钉住**，不许漂到掐点之上。
 */
export const STAGE_WALL_CLOCK_MS = 25 * 60 * 1000;

/**
 * 串行复跑的成本系数（相对第 1 遍的墙钟）。
 *
 * 为什么不能按「复跑只跑失败那两份」的比例算：实测第 2 遍只跑 2/98 份，却因为
 * `--no-file-parallelism` 去掉了并发优势而**更慢**（13.6 分钟 vs 9.2 分钟，1.48 倍）。
 * 按比例估会把界划在错的一边，所以按「同量再乘一份串行系数」估，系数取 2（比实测
 * 的 1.48 更保守 —— 估高只会让界更早落下，不会把还有希望的一遍拦掉）。
 */
export const SERIAL_RERUN_FACTOR = 2;

/**
 * 起一份预算（整次一份，跨块共享 —— 与 `waitBudget` 同一形状）。
 *
 * @param {{startMs?: number, budgetMs?: number}} [options]
 * @returns {{deadline: number, budgetMs: number}}
 */
export function wallClockBudget({
  startMs = Date.now(),
  budgetMs = STAGE_WALL_CLOCK_MS,
} = {}) {
  return { deadline: startMs + budgetMs, budgetMs };
}

/**
 * 还剩多少墙钟。
 *
 * 没给预算时回 `null` 而不是 `Infinity`：调用点要能分清「这一档没设界」与
 * 「还剩很多」，后者是读数、前者是形状（缺省值冒充无穷大就等于界悄悄没了）。
 *
 * @param {{deadline: number} | null | undefined} budget
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function remainingWallClockMs(budget, nowMs = Date.now()) {
  if (!budget) return null;
  return budget.deadline - nowMs;
}

/**
 * 第 2 遍（串行复跑）的成本估计。
 *
 * @param {number} firstPassMs 第 1 遍那一遍的真实墙钟
 * @returns {number}
 */
export function estimateSerialRerunMs(firstPassMs) {
  return Math.max(0, firstPassMs) * SERIAL_RERUN_FACTOR;
}

/**
 * 还开不开下一遍。
 *
 * ## 买不起那一遍时，界要落到哪一侧（2026-10-28 的读数订正）
 *
 * 界原来只有一条：`剩余 < 估计` ⇒ 第 2 遍**不开**，当场按未判定退 2。它治的是
 * 「用第三遍去赌一个本来就不会有的结论」，但它在**估计失真**时会做相反的事 ——
 * 而那正是本仓唯一一次实测到的形状：
 *
 * | 读数（build `cnb-u2e-1k619gnro`，PR #2598） | 值 |
 * | -- | -- |
 * | 第 1 遍（94 份固定清单 / 2 worker） | **16.1 分钟** |
 * | 估计（`estimateSerialRerunMs` = 首遍 × 2） | 32.4 分钟 |
 * | 剩余 | 8.8 分钟 |
 * | 实际：同机隔离跑那**一份**失败文件（`--no-file-parallelism`） | **0.4 秒** |
 *
 * 于是这一格连「一次真实测量」都没发生，却对着那一份文件说了「拿不到结论」。而
 * `runChunk` 里本来就有**逐文件补跑**那条更便宜的路：只跑失败的那几份、一份一个
 * 退出码、拿到的就是那一份自己的结论。两边要的东西不同 ——
 * `estimateSerialRerunMs` 估的是「**整块**在串行条件下重测」，而这里的 `probeFiles`
 * 只是「**失败的那几份**各跑一次」。
 *
 * ⇒ 两句都算，**任一成立**就开：`整块预算` 够，或 `补跑单价` 够。
 *   单价还不知道时（第一份）只放**一份**过去 —— 它跑出来的耗时就是后面那些的单价
 *   （与 `affordablePerFileCount` 同一条口径：不许用一个常数界替负载说话）。
 *
 * 这一格**不新增结论档、不碰任何预算档、不判哪一份红**：它改的只是「界落下之后是
 * 一句话都没有，还是先去量一份」。买不起那一份时那句话里要带上**逐文件补跑**这条
 * 下一动作（见 `wallClockSkipReport`）。
 *
 * @param {{budget?: {deadline: number} | null, estimateMs: number, nowMs?: number,
 *   probeFiles?: number, probePerFileMs?: number}} 入参 —— 前三个是整块判点，
 *   后两个是「逐文件补跑」那一档（份数与上一份的实测单价）
 *   `probeFiles` = 逐文件补跑要跑的份数（0 / 不给 ⇒ 按原来的整块判点）；`probePerFileMs`
 *   = 上一份实测单价（0 = 还没有单价）。
 * @returns {{ok: boolean, remainingMs: number | null, estimateMs: number,
 *   via: "block" | "probe", probeCount?: number}} 判决 —— 开不开、开哪一种、剩多少
 *   `via` 说的是「开的是哪一种」：`block` = 整块那一遍，`probe` = 逐文件补跑里先量的
 *   那几份（`probeCount` 是放过去的份数）；`ok` 是这一档到底开不开。
 */
export function budgetAllows({
  budget,
  estimateMs,
  nowMs = Date.now(),
  probeFiles = 0,
  probePerFileMs = 0,
}) {
  const remainingMs = remainingWallClockMs(budget, nowMs);
  if (remainingMs === null) {
    return { ok: true, remainingMs: null, estimateMs, via: "block" };
  }
  if (remainingMs >= estimateMs) {
    return { ok: true, remainingMs, estimateMs, via: "block" };
  }
  /* 界已经**过**了（剩余 ≤ 0）⇒ 一份都不开，连「先去拿个单价」也不许 —— 与
   * `affordablePerFileCount` 那一档同口径：这一刻开的任何一份都是在赌。
   * 读数上它对应的是「第 1 遍把预算全吃光」，与下面那一档（还剩一点、但买不起整块）
   * 是两件事。 */
  if (remainingMs <= 0) {
    return { ok: false, remainingMs, estimateMs, via: "block" };
  }
  /* 还剩一点、但买不起**整块**：先量**一份**。这一份的产出就是后面那些的单价 ——
   * 省掉它，界就永远只剩「一次测量都没有」这一种收场（现场：剩 8.8 分钟 < 整块估的
   * 32.4 分钟，而那一份实测 0.4 秒）。有单价之后按剩余量算份数，不凭常数。 */
  const probeCount =
    probeFiles <= 0
      ? 0
      : probePerFileMs > 0
        ? affordablePerFileCount({
            budget,
            perFileMs: probePerFileMs,
            pending: probeFiles,
            nowMs,
          })
        : Math.min(probeFiles, 1);
  if (probeCount > 0) {
    return { ok: true, remainingMs, estimateMs, via: "probe", probeCount };
  }
  return { ok: false, remainingMs, estimateMs, via: "block" };
}

/**
 * 逐文件补跑那一轮**买得起几份**。
 *
 * 单价用「上一份实测花了多久」，不用常数 —— 串行补跑的单价正是负载的函数，
 * 常数界会在机器空时过严、机器满时过松。三档形状各有各的说法：
 *
 *   · 没设界（`budget` 缺席）⇒ 全部照跑，与这条判点存在之前**逐字同形**；
 *   · 界已过（剩余 ≤ 0）⇒ 一份都不开，连「先去拿个单价」都不许；
 *   · 还没有单价可读（第一份）⇒ 只放**一份**过去 —— 它的产出就是后面那些的单价。
 *
 * @param {{budget?: {deadline: number} | null, perFileMs: number, pending: number, nowMs?: number}} args
 * @returns {number} 还能跑的份数（0 = 剩下的退回既有那条「拿不到自己的读数 ⇒ 退 2 并点名」）
 */
export function affordablePerFileCount({
  budget,
  perFileMs,
  pending,
  nowMs = Date.now(),
}) {
  const remainingMs = remainingWallClockMs(budget, nowMs);
  if (remainingMs === null) return pending;
  if (remainingMs <= 0 || pending <= 0) return 0;
  if (perFileMs <= 0) return Math.min(pending, 1);
  return Math.min(pending, Math.floor(remainingMs / perFileMs));
}

/**
 * 第 2 遍的**名单**：整块那一遍照旧跑全部失败文件，买不起整块时只跑买得起的那几份。
 *
 * 为什么把它挪到这一层：调用点此前是 `gate.via === "probe" ? slice(0, n) : scope.files`
 * 加一次 junit 读数，五件东西（档位、份数、读数、指纹、清单顺序）散在 `runChunk` 里，
 * 而其中**只有一件**是判断（挑谁）。收成一处之后，`runChunk` 那一句只剩装配。
 *
 * @param {{gate: {via: "block" | "probe", probeCount?: number}, files: string[],
 *   readSuites: () => {name: string, body: string}[],
 *   isTimeout: (text: string) => boolean}} args
 *   `readSuites` 是惰性的：不买不起整块那一档一次 junit 都不读
 * @returns {string[]} 第 2 遍要跑的文件（`via: "block"` ⇒ 全部）
 */
export function rerunFileList({ gate, files, readSuites, isTimeout }) {
  if (gate.via !== "probe") return [...files];
  return probeFiles({
    files,
    count: gate.probeCount ?? 1,
    readSuites: readSuites(),
    isTimeout,
  });
}

/**
 * 买得起的那几份**该挑哪几份**（ISSUE #2601）。
 *
 * `budgetAllows` 只回答「买得起几份」（`probeCount`），而调用点此前拿它去切
 * `scope.files.slice(0, n)` —— 那是**清单顺序**，与「哪一份最可能量出结论」毫无关系。
 * 于是一次真实测量可能落在三份**必然超时**的文件上，测出来的读音是「这一批仍只是超时
 * 形态」，而它们本来就该是这个读数 —— 那次测量的信息量为零，还不是最坏的一种。
 *
 * 排序只用**已经拿到手**的读数，不新增任何取数：
 *   1. junit 失败文本里**不带**超时指纹的排最前 —— 那份的红如果坐实，第二遍就会落
 *      `hard-fail`（真红，阻断并点名），那是这一格唯一能"多知道一件"的方向；
 *   2. 带指纹的、以及 junit 里**查不到自己**的排后面（这两档的下一动作都是复跑，
 *      谁先谁后不改变结论档位）—— 后一档仍要**留在**候选里：不在候选里就等于把它们
 *      从下面那条逐文件补跑里弄丢了；
 *   3. 同档内保持**清单顺序**（并行时 suite 的先后是完成次序，拿它当顺序会让同一份
 *      输入产出两条不同的命令行，与复跑面那条口径同源）。
 *
 * 这一格**不改任何结论档、不碰任何预算数**：它只决定「被放过去测量的那 n 份是谁」。
 *
 * @param {{files: string[], count: number,
 *   readSuites?: {name: string, body: string}[],
 *   isTimeout?: (text: string) => boolean}} args
 *   `isTimeout` 默认取 `isTimeoutShaped`（由调用点注入，本文件不复制第二份指纹清单）
 * @returns {string[]} 挑出来的文件（`count` ≤ 0 ⇒ 空；`count ≥ 份数` ⇒ 原样）
 */
export function probeFiles({
  files,
  count,
  readSuites = [],
  isTimeout = () => true,
}) {
  const list = Array.isArray(files) ? files : [];
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (n <= 0 || list.length === 0) return [];
  if (n >= list.length) return [...list];
  /** @type {Map<string, string>} */
  const bodyByName = new Map();
  for (const s of readSuites) {
    const prev = bodyByName.get(s.name) ?? "";
    bodyByName.set(s.name, `${prev}\n${s.body ?? ""}`);
  }
  /** 0 = 不带指纹（最该先量）；1 = 带指纹 / 查不到自己 */
  /** @param {string} file */
  const rank = (file) => {
    const body = bodyByName.get(file);
    if (body === undefined) return 1;
    return isTimeout(body) ? 1 : 0;
  };
  return list
    .map((file, index) => ({ file, index, rank: rank(file) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, n)
    .map((it) => it.file);
}

/**
 * 「补跑买不起下一份」这句话（同一档判点在逐文件那一轮上的形状）。
 *
 * 必须与上面那句分开说：那一轮停在半路时，剩下的文件**既没跑过也没被确认过**，
 * 读的人极容易把它当成「跑完了，都只是超时」—— 那句话正好是这一档最不该出现的。
 *
 * @param {{remainingMs: number, perFileMs: number, left: number}} args
 * @returns {string}
 */
export function perFileBudgetStopReport({ remainingMs, perFileMs, left }) {
  /** @param {number} ms */
  const fmt = (ms) => `${(Number(ms) / 1000).toFixed(1)}s`;
  return (
    `[affected-launch] 墙钟预算买不起下一份补跑（上一份实测 ${fmt(perFileMs)}、` +
    `剩余 ${fmt(remainingMs)}）\n` +
    `  ⇒ 剩下 ${left} 份**不跑**，按「拿不到自己的读数」点名（退 2），\n` +
    "  不是「已确认只是超时」—— 这一轮里它们一次都没被测量过。\n"
  );
}

/**
 * 把 `COMFY_AFFECTED_WALL_CLOCK_MS` 的原值收成一份预算（ISSUE #2364）。
 *
 * 为什么要有这个口子：界本身是一个**资源**数，不是判据 —— 共享机上「25 分钟够不够」
 * 由当天有几条流水线决定，而调它**不改变任何一条断言的判定**（与
 * `COMFY_PRECOMMIT_MAX_WORKERS` 同一条口径：只调资源，不碰判定；也正因如此，它不许被
 * 当成「让慢用例过关的旋钮」，那条界限见 §11.13 对 `expect.poll` 的说法）。
 * 第二个用处是**取证**：没有它，「界落下并说出未判定」这一档只能靠注入假时钟的用例
 * 证明，永远拿不到一次生产入口自己的读数。
 *
 * 非法值（非整数 / <1 / 空）一律**落默认值并提醒**，不静默退化成 0 ——
 * 0 会让界在第一次判决前就已用完，那一档看起来像「这次机器很慢」，实际是配置写错了。
 *
 * @param {string | undefined} raw 环境变量的原值
 * @returns {{budgetMs: number, note: string | null}}
 */
export function resolveWallClockMs(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return { budgetMs: STAGE_WALL_CLOCK_MS, note: null };
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    return {
      budgetMs: STAGE_WALL_CLOCK_MS,
      note:
        `COMFY_AFFECTED_WALL_CLOCK_MS 不是正整数毫秒（收到 ${JSON.stringify(raw)}）` +
        ` ⇒ 按默认 ${STAGE_WALL_CLOCK_MS}ms 办 —— 这一格只调资源，不改变任何判定。`,
    };
  }
  return { budgetMs: value, note: null };
}

/**
 * `runChunk` 那一段「界落在哪一侧」的**整份判决**（判点 + 那句「开的是什么」的话术）。
 *
 * 为什么要收成一处：这一段在 `runChunk` 里长成了「两个 `if` + 两个跨函数的变量」——
 * 而它判的是一件事（还开不开下一遍），拆成两段读的人就得自己把读数拼回去。放到这里
 * 还顺带让它可单独钉住（纯函数，不读盘、不读时钟：`firstPassMs` 由调用点量好传进来）。
 *
 * @param {{budget?: {deadline: number, budgetMs: number} | null, firstPassMs: number,
 *   retryFiles: number, nowMs?: number}} 入参 —— 首遍墙钟、要复跑的份数、当下时刻
 * @returns {{ok: boolean, via: "block" | "probe", probeCount?: number,
 *   remainingMs: number | null, estimateMs: number, note: string}} 判决与那句话
 *   （`via` 说的是「开的是哪一种」，与 `budgetAllows` 的同一格逐字同源）
 *   `via` 说的是「开的是哪一种」（整块 / 逐文件补跑里的 n 份）；`note` 是要打到 stderr
 *   的那段正文（空串 = 这一档什么都不用说）。
 */
export function gateRerunByWallClock({
  budget,
  firstPassMs,
  retryFiles,
  nowMs = Date.now(),
}) {
  const estimateMs = estimateSerialRerunMs(firstPassMs);
  const remainingMs = remainingWallClockMs(budget, nowMs);
  const gate = budgetAllows({
    budget,
    /* 首遍墙钟可能是 0（假时钟 / 极快的一遍）—— `0 >= 0` 会把「买不起」判成
     * 「买得起整块」，所以下界取 1（估算那一格本来就是个量级读数）。 */
    estimateMs: Math.max(1, estimateMs),
    probeFiles: retryFiles,
    /* 单价在这一层还未知（第一次走到这里），按「还没有单价 ⇒ 只放一份」那一档办。 */
    probePerFileMs: 0,
    nowMs,
  });
  /** @param {number} ms */
  const fmt = (ms) => `${(Number(ms) / 1000).toFixed(1)}s`;
  if (gate.via === "probe") {
    return {
      ...gate,
      note:
        "[affected-launch] 墙钟买不起**整块**串行复跑，但买得起**逐文件补跑** ——\n" +
        `  剩余 ${fmt(gate.remainingMs ?? 0)}、整块估计 ${fmt(estimateMs)}；` +
        `这一轮先量 ${gate.probeCount} 份，量出来的单价决定还放不放下一份\n` +
        "  （整块估计是按第 1 遍墙钟 ×2 推的，而实测里失败的那一份往往几秒钟就跑完，\n" +
        "   两者差一个量级 —— 所以这里不省掉那次真实的测量）。\n",
    };
  }
  /* 剩余 **≤ 0** 那一档与「还剩一点、但连一份都买不起」是两件事，话要分开说：
   * 前者是「第 1 遍把预算全吃光」，后者是「账上还剩钱，但只够买整块的那张票」。 */
  const broke = (remainingMs ?? 0) <= 0;
  return {
    ...gate,
    note: gate.ok
      ? ""
      : "[affected-launch] " +
        (broke
          ? "墙钟已经用完"
          : `墙钟买不起**整块**串行复跑（剩余 ${fmt(remainingMs ?? 0)} < 估计 ${fmt(estimateMs)}）`) +
        (broke ? "" : "，而**逐文件补跑**也一份都买不起") +
        " ⇒\n  第 2 遍不开。这不是红，也不是绿 ⇒ 按**未判定**收（退 2，ISSUE #2364）。\n",
  };
}

/**
 * 「第 2 遍因为预算没开」这句话（与 `runChunk` 里其它**判决当场**的话术同层，
 * 不是 `affected-launch-rerun-report.mjs` 那份收尾账）。
 *
 * 三件事必须在这段里说完：界是多少、为什么停、下一动作是什么。少任何一件，
 * 读的人就会把它当成「这一格挂了」去查产品代码（这正是 §11.23 那一族）。
 *
 * @param {{remainingMs: number | null, estimateMs: number, files: string[]}} args
 * @returns {string}
 */
export function wallClockSkipReport({ remainingMs, estimateMs, files }) {
  /** @param {number} ms */
  const fmt = (ms) => `${(Number(ms) / 60000).toFixed(1)} 分钟`;
  return (
    "[affected-launch] ⚠ **这一格的墙钟预算用完了 ⇒ 第 2 遍不开。**\n" +
    `  剩余 ${remainingMs === null ? "(没设界)" : fmt(remainingMs)}、` +
    `估计要 ${fmt(estimateMs)}（串行复跑按第 1 遍墙钟 ×${SERIAL_RERUN_FACTOR} 估 —— ` +
    "实测串行那一遍比并行那一遍更慢，所以不按比例算）。\n" +
    "  连**逐文件补跑**也买不起（那一档的单价还不知道时放一份过去，这里连那一份都没有）：\n" +
    "  逐文件补跑只跑失败的那几份、一份一个退出码，它比整块串行便宜得多 ——\n" +
    "  所以这句话之前本应先量过一份（见 `budgetAllows` 的 `probeFiles`）。\n" +
    "  这不是红，也不是绿，也不是「未校验」：未校验是**两次测量都只给超时指纹**，\n" +
    "  而这里连第二次测量都没有发生 ⇒ 按**未判定**收（退 2，规范 §13.6.4）。\n" +
    `  下面这 ${files.length} 份文件这次没有结论：\n` +
    files.map((f) => `    · ${f}\n`).join("") +
    "  下一动作：机器空下来时把那几份单独串行跑一次 ——\n" +
    "    pnpm exec vitest run --no-file-parallelism <那几份路径>\n" +
    "  ⚠️ **不要**抬 `testTimeout` / `hookTimeout`，也不要 --no-verify：\n" +
    "     本件的整个前提就是「争用不是预算不够」（§11.13）；界在这里，是为了让\n" +
    "     这一格在被平台掐掉之前**先把话说完**。\n"
  );
}
