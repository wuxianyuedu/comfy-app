#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:测试层裸 sleep 的用量(供 .githooks/pre-commit 的 D 组调用)
/**
 * 测试层「赌时间」的裸 `sleep` —— 规范见 docs/standards/11-测试与可观测性.md §11.14。
 *
 * ── 为什么要一条判据 ──────────────────────────────────────────────────
 *
 * §11.14 早就把 `await new Promise(r => setTimeout(r, N))` 定为**第一层反模式**，
 * 执行者写的是「新增时由 review 拦下，存量按节奏收口」。实测这句话两头都落空：
 *
 *   · 上一轮清掉的 6 个文件是**抽样**，口径没有钉住，于是同一个数在两次盘点里
 *     从 20 变成 38 —— 不是「修完又长回来」，而是**没有执行者在数**；
 *   · `grep -c test-sleep` 在 `.githooks/pre-commit` 里一直是 0，CI 又随
 *     ISSUE #623 删除 ⇒ §11.14 的「review 拦下」是这句话唯一的执行者，
 *     而 review 是人，人会漏（同 §13.5.12 立案现场：`check-comment-language.cjs`
 *     自称在钩子里跑、实际一个执行者都没有）。
 *
 * ── 它判什么、不判什么 ────────────────────────────────────────────────
 *
 * **不**判「有没有 sleep」（那会误报一片，见下面五类），判的是**有没有非豁免的
 * 裸 sleep 站点** —— **硬闸**：命中即退 1。
 *
 * 为什么必须是「逐类登记理由」而不是「零容忍」：下面五类里的 ①②③④ 都是**正当形态**，
 * 让它们全改成 `expect.poll` 是「把判据改坏」而不是「把代码改好」。一条会误报的
 * 判据活不过一次评审（§11.18.4），所以豁免不是赦免名单，而是**逐类登记的理由**。
 * 四类有理由的形态走 `// sleep-ok:` 声明，一条「根本不算站点」的口径由判据自认：
 *
 *   ① **根本不算站点：`setTimeout(…, 0)`** —— 它等的是**宏任务排空**（fire-and-forget
 *      的 promise 落定后登记镜像 / 冲刷微任务队列 / 让 effect 的一轮跑完），**没有时间
 *      预算可赌**，与 §11.14 的靶子无关（`expect.poll` 在这里要等满配置的 4s 预算、
 *      更慢也更绕）。这一条由**判据自己认出来**（`SETTIMEOUT_WITH_DELAY_RE`），
 *      不让那 7 处各写一条 `sleep-ok` —— 纯噪音会把「所有站点都得声明」变成一句空话。
 *
 *   ② **mock 内部延迟**：sleep 是**被测代码里的模拟耗时**（「每个查询慢一拍，
 *      串行实现峰值只能是 1」、「5s 的权威查询不该拖住首屏」），拿它来**暴露并发 /
 *      抢跑语义**。换成 `expect.poll` 等于把「制造慢」拆了 —— 判据本身会变弱
 *      （读数必须是「峰值 = 1」「dt < 2000」，而不是「等到了就算」）。
 *
 *   ③ **等一个「不会发生的事」**：断言的是**某件事一直没有发生**（「回包之后不得再出现
 *      调度读取」「表未就绪时首扫不读库」「open=false 时没有请求排出去」）。
 *      条件轮询表达不了「一直没有发生」（它能表达的只有「发生了」），
 *      §11.14 明写它是合法逃逸口。
 *
 *   ④ **必须走真挂钟的时序断言**：要 `createdAt` / `claimedAt` 拉开真实的毫秒差、
 *      要等防抖窗口过去、或 pino 底层异步落盘的 flush helper。假定时器会把被测逻辑
 *      一起冻住（推不动真文件写入），这类必须是真时间。
 *
 *   ⑤ **真该收口的**（已全数收口到 0 处）—— 手搓 `while + await setTimeout` 轮询、
 *      以及「睡一拍再断状态」。这正是 §11.14 的原靶：条件成立时照样等满、不成立时
 *      只留一句「超时」拿不到现场（`kill-process-tree` 那组换成条件轮询后
 *      文件耗时 3.5s → 0.5s）。它们**不进豁免**，由本判据的硬闸守住 ——
 *      再出现一处就当场断（ISSUE #1811 收尾时棘轮翻硬闸）。
 *
 * ① 之外的四类靠**逐站点** `// sleep-ok: <理由>` 声明豁免。**为什么不让判据自己认**：
 * 「等的是某个条件还是一直不会发生的事」语义上不可判（同一行写法可能两种意图），
 * 静态判会误报一片 —— 会误报的判据活不过一次评审（§11.18.4）。这与 §11.19 的隔离
 * 声明、§11.21 的消费方登记是同一档取舍：**让新增那一步过一个人的判断，而不是让机器猜**。
 *
 * ── 判定口径 ──────────────────────────────────────────────────────────
 *
 * 只数「**返回值被 await 的裸 Promise sleep**」这一形态，且**走 maskNonCode**
 * （字符串 / 注释 / 模板串里的站点不算 —— 本判据的自测夹具里就写着这个形态，
 * 判据去判自己的夹具是 §11.18.3.1 记过的坑）。
 *
 * 豁免靠**逐站点标记**而不是「整份文件豁免」：文件级豁免会让「这个文件里新增一处
 * 真赌时间」静默通过。标记是一条**紧邻站点的注释**：
 *
 *   // sleep-ok: <为什么这里必须是真时间 / 不是赌时间>
 *
 * 「紧邻」允许跨过「包着我的那一句的开头」（`vi.mocked(x).mockImplementation(` 这类
 * 以 `(` 收尾的续行）—— 否则声明写在站点上方两行时判据看不见它，声明就成了**摆设**
 * （声明在、判据从不看它，正是本判据立案现场的同一种病）。但**不许跨过一条真正的
 * 语句边界**：否则一条声明会把下面十几个站点全豁免。
 *
 * ── 门禁夹具不进收口面 ────────────────────────────────────────────────
 *
 * 本判据的自测（`tests/test-sleep-gate.test.ts`）里要写**被测字符串**，里面有真的
 * sleep 站点。这批站点由两件事挡住，**不靠人记得**：
 *
 *   ① 走 `maskNonCode` —— 字符串 / 注释 / 模板串里的站点本来就不是代码
 *      （同族先例：`tests/test-concurrency-gate.test.ts` 里 7 处 `setTimeout(…, 20)`
 *      是喂给并发判据的夹具，也在字符串里，自然不计数）；
 *   ② 自测文件所在路径登记在 `FIXTURE_SKIP` —— 挡住「夹具直接写成真代码」的写法，
 *      否则自测文件自己会被判红，而红的是它喂给判据的那口数据、不是它自己的行为
 *      （§11.18.3.1 记过的坑）。
 *
 * 本轮同一批已在规范里立了「**门禁夹具不进收口面**」的通用口径（§11.14 末），
 * 免得每轮都重复判一次「这个测试文件能不能改」。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 624 份用例，实测约 0.25s（零网络、零子进程）—— 照 §13.5.4 的成本判据，
 * 这个量级该进钩子而不是登记「按需召唤」（对照 `check-comment-language.cjs` 那条
 * 1695 文件 / < 1s 的翻档判据）。
 *
 * 用法：
 *   node scripts/check-test-sleep.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-test-sleep.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const path = require("node:path");
const { maskNonCode } = require("./check-test-concurrency.cjs");
const {
  readForScan,
  walkForScan,
  vanishedNote,
} = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径。 */
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * 自测夹具**不进扫描面**：它是喂给本判据的被测字符串，判它等于判自己的量具。
 * 与 `scripts/check-test-concurrency.cjs` 的夹具处理同源（同族先例见 §11.18.3.1）。
 */
const FIXTURE_SKIP = new Set(["tests/test-sleep-gate.test.ts"]);

/**
 * 裸 sleep 站点的三个条件（三条正则合起来判一处）：
 *
 *   ① `new Promise(` 起头（`PROMISE_RE`）；
 *   ② 窗口里有**带非零预算**的 `setTimeout(…)`（`SETTIMEOUT_WITH_DELAY_RE`）——
 *      `setTimeout(r, 0)` 不算，它是让出宏任务，见那条正则的注释；
 *   ③ 这个 Promise 被「等这条语句过去」—— 前缀是 `await` / `return`，或零参箭头
 *      `() =>`（`ZERO_ARG_ARROW_RE`）；带参箭头是回调，不算。
 *
 * **为什么不是一个正则一把抓**：三条各答一个不同的问题（有没有定时器 / 定时器有没有
 * 预算 / 是不是「等这句过去」），合起来写成一个正则之后每改一条口径都要重读整串，
 * 而本判据恰恰是靠「口径能逐条自证」才有价值的（自测 13 条各钉一条）。
 *
 * ⚠️ **折行形态要认**：prettier 会把长语句折成
 * `await new Promise((r) =>` / `setTimeout(r, 25),` / `);`。只认行内字面量会整片漏出
 * 扫描面（§11.18.3.1 那条的同族）。
 *
 * ⚠️ **不数括号**（`WINDOW_MAX` 封了个窗口上限）：数括号要区分 JSX / 箭头 / 正则，
 * 每修一处再加一层词法分析（§11.18.3 的取舍），而这件事与「这里有没有一处 sleep」
 * 无关。窗口内的假阳性由 `sleep-ok` 声明吸收。
 */
const PROMISE_RE = /(?<![\w.$])new\s+Promise\b/g;

/**
 * 窗口里的 `setTimeout(…)` 调用**有没有给出时间预算**。
 *
 * 判据只认「带非零延时」的形态：`setTimeout(r, 0)` 不是「等 N 毫秒」，它是
 * **让出一轮宏任务**（等 fire-and-forget 的 promise 落定 / 冲洗微任务队列 /
 * 让 effect 的一轮跑完）。那件事与 §11.14 的靶子无关：没有时间预算可赌，
 * `expect.poll` 在这里要等满配置的 4s 预算、更慢也更绕。
 *
 * 所以「0 不算」由**判据自己认出来**，而不是让那 7 处各写一条 `sleep-ok` ——
 * 后者会把「所有站点都得声明」变成一句空话（纯噪音会把声明这件事变成流程），
 * 而这条口径在文字上说不清「0 与 25 的区别」时，最该做的是让判据认出来。
 *
 * 认的是「括号里出现了非零数字字面量」：`setTimeout(r, 25)` / `setTimeout(resolve, 20)`
 * / `setTimeout(() => r(8188), 5000)` 命中；`setTimeout(r, 0)` / `setTimeout(resolve, 0)`
 * 不命中。变量延时（`setTimeout(r, delay)`）命中 —— 它是预算，只是运行时才知道。
 *
 * ⚠️ 认不出来的一律**按落后处理**（宁可多报、不少报）：`setTimeout(r, 0)` 写成了
 * `setTimeout(r, 0 /* 让出宏任务 *\/)` 这种带注释的形态仍会被判成站点，收到
 * `sleep-ok` 就能过；反过来（漏报）会让判据对真站点失明。
 */
const SETTIMEOUT_WITH_DELAY_RE =
  /setTimeout\s*\([^;]{0,160}?[,(]\s*(?:[1-9]\d*|\d*\.\d+|[A-Za-z_$][\w$.]*)\s*[,)]/;

/**
 * 零参箭头直接返回它（`const flush = () => new Promise(…)`）—— 前缀以 `() =>` 收尾。
 * 只认零参：带参的箭头多半是回调（`.map((n) => new Promise(…))`），那是「造一个慢
 * 东西丢进集合」而不是「等这条语句过去」（自测第 ⑤ 条钉着这个边界）。
 */
const ZERO_ARG_ARROW_RE = /\(\s*\)\s*=>\s*$/;

/** 站点的前缀窗口：往回找 `await` / `return` 最多这么多字符。 */
const AWAIT_LOOKBEHIND = 24;
/** `new Promise(` 起头之后的搜索窗口上限（防跨大段代码误配）。 */
const WINDOW_MAX = 300;

/**
 * 豁免声明：一条紧邻站点的注释，写明「为什么这里必须是真时间 / 不是赌时间」。
 * 要有内容 —— 只有标签、后面空着，与没有声明等价（同 §11.19 的隔离声明口径）。
 */
const SLEEP_OK_RE = /\/\/\s*sleep-ok\s*[：:]\s*(\S.*)/;

/**
 * 枚举扫描面。**两种消失窗口**（「列到名字、读时已没」与「枚举当场 `ENOENT`」）、
 * 「只有 `ENOENT` 降级、权限/形状错误照冒」与「不许静默」的口径都在
 * `gate-scan-read.cjs` —— 这一度是本文件自己写的一份，与
 * `check-test-waitfor.cjs` / `check-test-it-each.cjs` / `check-annotate-consumer.cjs`
 * 逐字同形，四处私有副本的含义（改一处漏三处）由 `tests/gate-scan-read.test.ts` 收口。
 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE);
}

/** 第几行（1 起）：数到某个字符偏移为止的换行数。 */
function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") n += 1;
  return n;
}

/**
 * 找「紧邻站点之前」的豁免声明。
 *
 * 认两种位置：① 站点所在行**之上**最近的若干行注释（`// sleep-ok: …`）——
 * 这是主要形态（理由写在站点上方）；② 站点所在行的行尾注释。取「最近的一条」，
 * 中间隔了非注释代码就断开（免得一条声明把下面十几个站点全豁免了）。
 *
 * @param {string} raw
 * @param {number} siteIndex 站点在原文里的偏移
 * @returns {string | null} 声明正文（非空），没有则 null
 */
function nearbySleepOk(raw, siteIndex) {
  const line = lineOf(raw, siteIndex);
  const lines = raw.split("\n");
  /* ① 行尾注释 */
  const ownLine = lines[line - 1] ?? "";
  const tail = ownLine.match(SLEEP_OK_RE);
  if (tail) return tail[1].trim();
  /* ② 向上走。**能跨过「包着我的那一句的开头」** —— 站点常常长这样：
   *
   *     // sleep-ok: <理由>
   *     vi.mocked(x).mockImplementation(
   *       () => new Promise((r) => setTimeout(() => r(1), 5000)),
   *     );
   *
   * 声明在站点上方两行，中间隔着那个「调用开头」。只认「紧邻的连续注释块」
   * 会把它判成「没有声明」，于是人明明登记了、判据却看不见（声明成摆设，
   * 正是本判据立案现场的同一种病）。
   *
   * 但**不许跨过一条真正的语句边界** —— 否则一条声明会把下面十几个站点全豁免。
   * 判据：允许跨过的行只有两种 —— 注释行、以及**以左括号 / 逗号收尾**的续行
   * （`foo(` / `=> (` / `],` 这类）。遇到别的就断。
   */
  for (let i = line - 2; i >= 0 && i >= line - 8; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    const hit = t.match(SLEEP_OK_RE);
    if (hit) return hit[1].trim();
    const isComment =
      t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
    /* 续行：以 \`(\` / \`,\` / \`[\` / \`{\` 收尾 —— 它不构成一条独立语句。 */
    const isContinuation = /[(,[{]\s*$/.test(t);
    if (!isComment && !isContinuation) break;
  }
  return null;
}

/**
 * 扫一个文件，返回它命中的 sleep 站点；文件在「列目录 → 读内容」之间消失时返回 `null`。
 * @param {string} abs
 * @returns {{line: number, text: string, exempt: string | null}[]|null}
 */
function scanFile(abs) {
  /* 消失时 `null` = 这一轮没读到，调用方计数（口径见 `gate-scan-read.cjs`，
   * 与上面 `walk` 那条是同一种竞态的两个窗口）。 */
  const raw = readForScan(abs);
  if (raw === null) return null;
  const masked = maskNonCode(raw);
  const sites = [];

  for (const m of masked.matchAll(PROMISE_RE)) {
    const start = m.index;
    /* 窗口：`new Promise(` 起头之后到配对收口（或窗口上限）。这里不数括号 ——
     * 只要找到窗口内是否出现 `setTimeout(` 就够，本判据数的是「Promise 里带定时器」
     * 这个形状，数括号会让判据多一层词法分析而与它要回答的问题无关（§11.18.3 同款取舍）。 */
    const window = masked.slice(start, start + WINDOW_MAX);
    if (!SETTIMEOUT_WITH_DELAY_RE.test(window)) continue;

    /* 是不是「等这条语句过去」：满足任一条即算 ——
     *   ① 前缀里紧跟 `await` / `return`（`await new Promise(…)`）；
     *   ② 前缀是零参箭头 `() =>` —— 箭头函数**直接返回**它：
     *      `const flush = () => new Promise((r) => setTimeout(r, 30))`。
     * 后者是一条独立的「等 N 毫秒」helper，漏掉它会让这类站点整片出扫描面
     * （真站点被判成 0 处），而它的 `sleep-ok` 声明就成了**摆设**
     * （声明在、判据从不看它，正是本判据立案现场的同一种病）。
     *
     * ⚠️ ② 刻意**只认零参箭头**（前缀是 `()`）：带参的箭头多半是**回调**
     * （`list.map((n) => new Promise((r) => setTimeout(r, n)))`）—— 那是「造一个
     * 慢东西丢进集合」，不是「等这条语句过去」，不在本判据的靶子里
     * （自测第 ⑤ 条钉着这个边界）。放宽成任意 `=>` 会把它一并算进来。
     *
     * 前缀只往回看一小段 —— 更早的 `await`（上一句的）不该算作这一句的。 */
    const prefix = masked.slice(Math.max(0, start - AWAIT_LOOKBEHIND), start);
    const isAwaitOrReturn =
      /(?<![\w.$])(?:await|return)\s*$/.test(prefix) ||
      ZERO_ARG_ARROW_RE.test(prefix);
    if (!isAwaitOrReturn) continue;

    /* 站点文字取原文（mask 过的是空格），给报错一个可读的现场。 */
    const line = lineOf(masked, start);
    const rawLine = raw.split("\n")[line - 1] ?? "";
    sites.push({
      line,
      text: rawLine.trim().replace(/\s+/g, " ").slice(0, 100),
      exempt: nearbySleepOk(raw, start),
    });
  }
  return sites;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  /** 全部非豁免站点，按文件归拢。 */
  const live = new Map();
  /** 已豁免站点（只记账，不参与棘轮）。 */
  const exempt = new Map();
  let exemptTotal = 0;
  /** 「列到名字、读时已没」的份数（并发用例的临时探针），必须出现在结论里。 */
  let vanished = 0;

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (FIXTURE_SKIP.has(rel)) continue;
    const sites = scanFile(abs);
    if (sites === null) {
      vanished += 1;
      continue;
    }
    const liveSites = sites.filter((s) => !s.exempt);
    const exemptSites = sites.filter((s) => s.exempt);
    if (liveSites.length > 0) live.set(rel, liveSites);
    if (exemptSites.length > 0) {
      exempt.set(rel, exemptSites);
      exemptTotal += exemptSites.length;
    }
  }

  const liveTotal = [...live.values()].reduce((n, v) => n + v.length, 0);

  /* 存量已清零 ⇒ 这是硬闸：**每一处非豁免站点都阻断**，没有基线、没有 `--update`。
   * 此前它是棘轮（`scripts/.test-sleep-baseline.json`），而清零后的棘轮只剩两个
   * 无事可做的动作 + 一条「手改 JSON 就能把新站点登记成已知存量」的通道 ——
   * 硬闸类本来没有那个中间态（§13.6.2 的两类对照）。
   * 正当形态（等宏任务排空 / mock 内部延迟 / 等一件不会发生的事 / 必须真挂钟）
   * 走**另一条已经存在的车道**：站点上方 `// sleep-ok: <理由>` 逐条声明。 */

  if (REPORT_ONLY) {
    console.log(
      `[test-sleep] 盘点：裸 sleep ${liveTotal} 处 / 声明豁免 ${exemptTotal} 处。`,
    );
    for (const [rel, sites] of [...live.entries()].sort()) {
      console.log(
        `  · ${rel}: ${sites.length} 处（第 ${sites.map((s) => s.line).join(",")} 行）`,
      );
    }
    return 0;
  }

  if (liveTotal === 0) {
    console.log(
      `[test-sleep] OK —— 裸 sleep 0 处 / 声明豁免 ${exemptTotal} 处。` +
        /* 消失数必须进结论：它等于「这几份文件这一轮没被读过」。静默让判据在没读过的
           目录上绿，是 §13.5.12 那一族「自称在跑、实际没跑」的入口。 */
        vanishedNote(vanished),
    );
    return 0;
  }

  console.error(
    `[ERROR] 测试层裸 sleep ${liveTotal} 处（本判据是硬闸：存量已清零，新增即阻断）。\n` +
      "\n  §11.14 的口径是「等一个条件变成真一律写 `expect.poll`」——" +
      "\n  `await new Promise(r => setTimeout(r, N))` 是**赌时间**：条件早已成立时照样等满，" +
      "\n  条件永远不成立时只留一句「超时」、拿不到现场。" +
      "\n\n  修法：" +
      "\n    · 等条件收敛 → `await expect.poll(() => 取当前值).toBe(…)`（预算见 vitest.config.ts）；" +
      "\n    · 真要真挂钟（假定时器会冻住被测逻辑）/ 等宏任务排空 / 是 mock 内部延迟" +
      "\n      → 在站点上方写一条 `// sleep-ok: <为什么这里必须是真时间>`，声明后不计入；" +
      "\n    · 判据自己的夹具不进收口面（`FIXTURE_SKIP`），别为了过门禁去改量具。",
  );
  for (const [rel, sites] of [...live.entries()].sort()) {
    console.error(
      `  · ${rel}: ${sites.length} 处\n` +
        sites
          .slice(0, 6)
          .map((s) => `      ${s.line}: ${s.text}`)
          .join("\n") +
        (sites.length > 6 ? `\n      …另有 ${sites.length - 6} 处` : ""),
    );
  }
  console.error("\n口径见 docs/standards/11-测试与可观测性.md §11.14。");
  return 1;
}

/* 自测（`tests/test-sleep-gate.test.ts`）钉的是**站点识别口径** —— 它是个纯逻辑，
 * 而它的失效形态（只认行内字面量、把宏任务排空也算成赌时间）在临时仓库里
 * 造不出来稳定复现。只导出扫描函数与豁免解析。 */
module.exports = { scanFile, nearbySleepOk, walk };

/* 被 import 时（自测）只导出、不执行；被当脚本跑时（钩子）才判。 */
if (require.main === module) process.exit(main());
