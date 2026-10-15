#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：测试层「一个用例一把时钟」（供 .githooks/pre-commit 的 D 组调用）
/**
 * 「一个用例一把时钟」的形状判据 —— 规范见 docs/standards/11-测试与可观测性.md §11.14。
 *
 * ── 为什么要一条判据 ──────────────────────────────────────────────────
 *
 * §11.14 新立了那条口径，但它此前**只有文档**：写着别这样写，而没有任何东西认得那个
 * 形状 —— 与 `check-theme-colors.cjs` 之前那两句 ❌ 同一种债（主张没有执行者）。而它的
 * 失效形态是**成对的负载红**：
 *
 *   · 用例先用真实时钟 `expect.poll(...)` 等一段，再 `vi.useFakeTimers()` 开窗口 —— 那
 *     一段的耗时由机器当下给多少算多少，而 `testTimeout` 有上界；一旦越过，被抛下的
 *     continuation 落进**下一条**用例的假时钟窗口，于是先 `Test timed out in 30000ms`、
 *     再 `Timer APIs are not mocked`。实测（16 核 + 24 个忙等进程，同一命令 3 组配对
 *     样本）：这一族两条用例的墙钟耗时 1301 / 2419 / 3895ms（同形状自己就差 3 倍），
 *     改成一把时钟之后 568 / 768 / 769ms。
 *   · 更直接的一种：`expect.poll` 落在已经开好的假时钟窗口里 —— 它**不推进**假定时器
 *     （§11.14 那张表明写；`vi.waitFor` 才会），所以那次轮询只能等到自己的预算用尽。
 *
 * ── 它判什么 ─────────────────────────────────────────────────────────
 *
 * 逐**用例体**判（体 = 一个 `it(...)` / `test(...)` 实参覆盖的那一段，含
 * `it.each([...])(...)` 那种两段式）：
 *
 *   规则 A：体内出现 `vi.useFakeTimers()`，且在它之前出现真实时钟等待
 *           （`expect.poll(` 或 `await waitFor(`）⇒ 阻断。
 *   规则 B：体内出现 `expect.poll(`，而它落在假时钟之内 ⇒ 阻断。窗口分两种来源，
 *           算法**必须**分开（见 `fakeWindows` 与 scanFile 里那段注释）：
 *             · 开在**本体内**：到体内下一处 `vi.useRealTimers()` 为止；
 *             · 开在**体外**（`beforeEach` / 顶层）：罩住同一个 `describe` 作用域里的
 *               每一个用例体，除非那个体自己在轮询之前把时钟还了回去。
 *
 * ── 它不判什么（明写在案，别当成漏报）──────────────────────────────────
 *
 *   · **挂载发生在换时钟之前**（口径推荐的形状，但不是危害本身）：挂载不挂起任何东西，
 *     挂起的是等待。实测全仓这一形状还剩 1 处
 *     （`use-workshop-pipeline-recovery.test.ts` 那条 SSE 安全阀用例），它是正当的 ——
 *     挂载之后用 `await act(async () => { await Promise.resolve(); })` 走 microtask 落定，
 *     没有任何墙钟等待。判它等于造一台误报机（§12.18）。
 *   · 窗口内的 `await waitFor(` —— RTL 的 `waitFor` 每轮自动推进假定时器，那正是
 *     `check-test-waitfor.cjs` 列为**正当**的一档；本判据只把它当规则 A 的「窗口之前」标记。
 *   · `vi.waitFor(...)` —— 同上，它在假定时器下自推进，不是墙钟等待。
 *   · 裸 `setTimeout` 延时 —— 归 `check-test-sleep.cjs` 判，两条各判一件事，不在这里重复立案。
 *   · 注释与字符串里的标记 —— 走 `maskNonCode`，认的是代码行。
 *   · 判据自己的夹具不进扫描面（`FIXTURE_SKIP`，§11.14.2 的通用口径）。
 *   · **跨 `describe` 的归属**：「假时钟开在隔壁 `describe` 的 `beforeEach`、poll 在
 *     前一个 `describe` 的体里」不报 —— 那条窗口根本没盖住这个用例。这不是推演：早期
 *     一把不看块边界的粗数正是这么把 `use-throttled-progress.test.tsx` 数出两处假阳性的。
 *
 * ── 成本 ────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 `src/**` + `tests/**` 的用例文件（实测 735 份），本机 < 1s、零网络零子进程 ——
 * 照 §13.5.4 的成本判据，这个量级该进钩子而不是登记「按需召唤」。
 *
 * 用法：
 *   node scripts/check-test-single-clock.cjs            # 检查（硬闸：命中即退 1）
 *   node scripts/check-test-single-clock.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。两条规则实测存量都是 **0**，所以没有基线、也没有 `--update`。
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

/** 判据自己的夹具不进扫描面（下面的被测字符串里就有真的 `expect.poll`）。 */
const FIXTURE_SKIP = new Set(["tests/test-single-clock-gate.test.ts"]);

/** 用例体起点：`it(` / `test(`，含 `it.each(` / `test.skip(` 这类变体。 */
const IT_OPEN_SRC = String.raw`(?:^|[\s;}])(?:it|test)(?:\.\w+)*\s*\(`;
/** `describe(` 起点 —— 体外开的窗口要靠它绑到正确的用例集合上。 */
const DESCRIBE_OPEN_SRC = String.raw`(?:^|[\s;}])describe(?:\.\w+)*\s*\(`;
const FAKE_ON_SRC = String.raw`vi\.useFakeTimers\s*\(`;
const FAKE_OFF_SRC = String.raw`vi\.useRealTimers\s*\(`;
/**
 * 真实时钟等待的两个标记。
 *
 * ⚠️ 名单**不收** `vi.waitFor(`（它在假定时器下自推进）与裸 `setTimeout`（归
 * `check-test-sleep.cjs`）。少一条是漏报、多一条是误报 —— 这里宁缺：漏掉的那条
 * 已经有别的判据在守，误报的那条会让整条判据活不过一次评审（§12.18）。
 */
const POLL_SRC = String.raw`(?<![\w.$])expect\.poll\s*\(`;
const WAIT_FOR_SRC = String.raw`(?<![\w.$])await\s+waitFor\s*\(`;

/**
 * **每次都用新构造的正则**，不共享模块级带 `g` 的实例。
 *
 * 共享一个 `g` 正则去配 `lastIndex`，在本判据里有两条**静默**死法，都是实测踩到的：
 *   · `exec` 循环把 `lastIndex` 停在文件末尾 ⇒ 下一份文件的 `matchAll` 从那里起步，
 *     于是「全仓只有第一份文件被看过」而照样绿；
 *   · `slice(a, b).matchAll(re)` 会**复制** `lastIndex` 而搜索的是切片，游标落在切片
 *     之外时恒不命中 —— 规则 B 的第一版就是这么把自己判死的（自测一格钉住）。
 */
const g = (src) => new RegExp(src, "g");

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

/**
 * 从某个左括号开始配平，返回配平的右括号下标；配不平返回 -1。
 *
 * 为什么可以直接数括号：喂进来的是 `maskNonCode` 之后的文本 —— 字符串与注释已经变成
 * 同长度空白，里面的 `(` `)` 进不了深度（那是 `check-test-concurrency.cjs` 那份 mask 的
 * 既有语义，本判据不重实现第二份）。
 */
function matchParen(masked, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 枚举用例体。
 *
 * `it.each([...])("名字, fn)` 是**两段**括号：第一段是 `.each` 的实参、第二段才是用例。
 * 只取第一段会得到一段「体里没有函数」的区间，规则在那份文件上静默不响 —— 所以第一段
 * 之后紧跟 `(` 时必须把两段并起来（自测里那格就是钉这个）。
 */
function testBodies(masked) {
  const bodies = [];
  const re = g(IT_OPEN_SRC);
  let m;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].lastIndexOf("(");
    const first = matchParen(masked, open);
    if (first < 0) continue;
    let end = first;
    let after = first + 1;
    while (after < masked.length && /\s/.test(masked[after])) after += 1;
    if (masked[after] === "(") {
      const second = matchParen(masked, after);
      if (second > 0) end = second;
    }
    bodies.push({ start: open, end });
    re.lastIndex = end;
  }
  return bodies;
}

/** 枚举 `describe(...)` 的作用域区间。 */
function describeScopes(masked) {
  const out = [];
  const re = g(DESCRIBE_OPEN_SRC);
  let m;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].lastIndexOf("(");
    const end = matchParen(masked, open);
    if (end > 0) out.push({ start: open, end });
  }
  return out;
}

/** 包住某个下标的**最内层** describe；没有就用整个文件区间（顶层）。 */
function innermostScope(scopes, index, total) {
  let best = null;
  for (const s of scopes) {
    if (index <= s.start || index >= s.end) continue;
    if (!best || s.end - s.start < best.end - best.start) best = s;
  }
  return best ?? { start: 0, end: total };
}

/** 区间里某个模式的首个命中下标（在**切片**上找，再把偏移加回来）；没有返回 -1。 */
function firstIn(masked, range, src) {
  const scoped = masked.slice(range.start, range.end + 1);
  const hit = new RegExp(src).exec(scoped);
  return hit ? range.start + hit.index : -1;
}

/** 区间里某个模式的全部命中下标（同上，切片法 —— 避开 `matchAll` 的游标坑）。 */
function allIn(masked, range, src) {
  const scoped = masked.slice(range.start, range.end + 1);
  const re = g(src);
  const out = [];
  let m;
  while ((m = re.exec(scoped))) out.push(range.start + m.index);
  return out;
}

/**
 * 假时钟窗口：每处 `vi.useFakeTimers()` 到**源文本里下一处** `vi.useRealTimers()`，
 * 后面没有还原就到文件末尾。
 *
 * ⚠️ 这个尾只在「窗口开在某个用例体内」时可信。`beforeEach` / `afterEach` 是成对写在
 * 用例**之前**的，按源文本算会把窗口收得比第一个用例还早 ⇒ 那种窗口改走 describe 归属
 * （见 scanFile 的规则 B）。少这一步，最危险的一档就永远不响。
 */
function fakeWindows(masked) {
  const ons = allIn(masked, { start: 0, end: masked.length - 1 }, FAKE_ON_SRC);
  const offs = allIn(
    masked,
    { start: 0, end: masked.length - 1 },
    FAKE_OFF_SRC,
  );
  return ons.map((on) => {
    const off = offs.find((o) => o > on);
    return { start: on, end: off ?? masked.length - 1 };
  });
}

/**
 * 扫一个文件，返回它命中的站点（空数组 = 干净）。
 *
 * @param {string} abs
 * @param {string} raw
 */
function scanFile(abs, raw) {
  if (FIXTURE_SKIP.has(path.relative(ROOT, abs).split(path.sep).join("/"))) {
    return [];
  }
  const masked = maskNonCode(raw);
  const bodies = testBodies(masked);
  const scopes = describeScopes(masked);
  const windows = fakeWindows(masked);
  const hits = [];
  const site = (index, rule, note) => {
    const line = lineOf(masked, index);
    return {
      rule,
      line,
      text: raw.split("\n")[line - 1].trim().slice(0, 100),
      note,
    };
  };
  const bodyOf = (index) =>
    bodies.find((b) => index > b.start && index < b.end);

  /* ── 规则 A：同一用例体内，墙钟等待早于换假时钟 ── */
  for (const body of bodies) {
    const fakeAt = firstIn(masked, body, FAKE_ON_SRC);
    if (fakeAt < 0) continue;
    for (const [src, name] of [
      [POLL_SRC, "expect.poll"],
      [WAIT_FOR_SRC, "await waitFor"],
    ]) {
      const waitAt = firstIn(masked, body, src);
      if (waitAt < 0 || waitAt > fakeAt) continue;
      hits.push(
        site(
          waitAt,
          "A",
          `${name} 早于 L${lineOf(masked, fakeAt)} 的 vi.useFakeTimers() —— 同一格里两把时钟`,
        ),
      );
    }
  }

  /* ── 规则 B：expect.poll 落在假时钟之内 ── */
  for (const w of windows) {
    const windowBody = bodyOf(w.start);
    if (windowBody) {
      for (const index of allIn(masked, w, POLL_SRC)) {
        if (!bodyOf(index)) continue;
        hits.push(
          site(
            index,
            "B",
            `expect.poll 落在同一格里 L${lineOf(masked, w.start)} 开出的假时钟窗口内，而它不推进假定时器`,
          ),
        );
      }
      continue;
    }
    const scope = innermostScope(scopes, w.start, masked.length);
    for (const body of bodies) {
      if (body.start < scope.start || body.end > scope.end) continue;
      for (const index of allIn(
        masked,
        { start: body.start, end: body.end },
        POLL_SRC,
      )) {
        if (
          firstIn(
            masked,
            { start: body.start, end: index - 1 },
            FAKE_OFF_SRC,
          ) >= 0
        ) {
          continue;
        }
        hits.push(
          site(
            index,
            "B",
            `体外 L${lineOf(masked, w.start)} 开的假时钟窗口罩住整个 describe，而 expect.poll 不推进假定时器`,
          ),
        );
      }
    }
  }

  return hits;
}

const violations = new Map();
let scanned = 0;
const vanished = [];

for (const dir of SCAN_DIRS) {
  for (const abs of walkForScan(path.join(ROOT, dir), TEST_FILE_RE)) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const raw = readForScan(abs);
    if (raw === null) {
      vanished.push(rel);
      continue;
    }
    scanned += 1;
    const hits = scanFile(abs, raw);
    if (hits.length) violations.set(rel, hits);
  }
}

/** 打印站点清单：一行一个站点，带 `文件:行` —— 命中多处时不靠分组标题猜归属。 */
function printViolations() {
  for (const [rel, hits] of [...violations.entries()].sort()) {
    for (const h of hits.sort((a, b) => a.line - b.line)) {
      console.log(
        `  ✗ ${rel}:${h.line}（规则 ${h.rule}）${h.text}\n      ↳ ${h.note}`,
      );
    }
  }
}

const totalHits = [...violations.values()].reduce((n, v) => n + v.length, 0);

if (REPORT_ONLY) {
  if (totalHits) printViolations();
  console.log(
    `[single-clock] --report：扫描 ${scanned} 份用例文件，越界 ${totalHits} 处（不判失败）`,
  );
  if (vanished.length) console.log(vanishedNote(vanished));
  process.exit(0);
}

if (totalHits > 0) {
  printViolations();
  console.error(
    `\n[single-clock] ${totalHits} 处「一个用例里挂了两把时钟」（规范 11 §11.14）。\n` +
      "  为什么值得拦：先等墙钟、后换假时钟的那一段，耗时由机器当下给多少算多少，而\n" +
      "  `testTimeout` 有上界；越过之后被抛下的 continuation 会落进**下一条**用例的假时钟\n" +
      "  窗口 ⇒ 症状成对（先 `Test timed out`、再 `Timer APIs are not mocked`）。\n" +
      "  规则 B 更直接：`expect.poll` 不推进假定时器，落在窗口里就只能等到自己的预算用尽\n" +
      "  （会自推进的是 `vi.waitFor`）。\n" +
      "  出路只有两条：**整条用例一把时钟**（挂载之前就换时钟，用\n" +
      "  `await act(async () => { await vi.advanceTimersByTimeAsync(N) })` 把挂载链跑到落定），\n" +
      "  或者整条都用真实时钟。别抬超时、也别给 `expect.poll` 加预算 —— §11.13 明写预算是\n" +
      "  给真进程留的余量，不是给慢用例兜底。",
  );
  if (vanished.length) console.error(vanishedNote(vanished));
  process.exit(1);
}

console.log(
  `[single-clock] OK —— 扫描 ${scanned} 份用例文件：一个用例一把时钟，越界 0 处。`,
);
if (vanished.length) console.log(vanishedNote(vanished));

module.exports = {
  scanFile,
  testBodies,
  describeScopes,
  fakeWindows,
  matchParen,
};
