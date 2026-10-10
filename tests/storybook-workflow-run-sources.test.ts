/**
 * 「工作流运行（执行日志）→ story」注入层的**契约判据**
 *（ISSUE #1381 续，规范 16 §16.2.3.15）。
 *
 * 为什么需要它：`TaskLogTimeline` 是**纯 props** 的，看起来「给一数组就能摆」——
 * 而它吃的那个数组在真机上是 `workflow-run-store` 按 SSE 帧累积出来的
 * `TaskLogEntry[]`。手捏一份字面量会跳过 store 的两条真实取舍：
 *
 *  · **按 `(t, msg)` 去重**（SSE 重放与增量推送会发同一帧）；
 *  · **`MAX_LOGS`（300）截尾**（长任务几千条 progress 行）。
 *
 * 两者都决定画布上的计数与截尾口，所以「手捏数组」的失效形态是「画布看着对、
 * 真机上不对」—— 与这一整族注入层同源。
 *
 * 另有两处**只有真机才会暴露、而画布上照样有内容**的坑，一并钉住：
 *
 *  · **失败行与整条链路的时刻要落在同一段里**。`failWorkflowRun()` 补的 error 行
 *    用的是它自己的 `Date.now()`（生产口径）；若场景把步骤锚在一个写死的日期上，
 *    画布上会出现「最后一步 09:30、失败行 18:32」——同一次运行差九个多小时，
 *    读故事的人会以为哪里算错了（本批实测抓到过）。
 *  · **装饰器要挂在链上**，否则 `parameters.runScene` 没人读，story 在那儿、
 *    时间线空着，而全绿。
 *
 * 判的是**接线与形状**，不是语义（「有没有真的画出来」由真浏览器逐 story 渲染
 * 核对那一半守着）。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* 「先剥注释再正则」的唯一实现（§12.18 / ISSUE #1192）：本文件里有**否定**断言
   （「不许直接改 runs」），而那正是散文里解释「为什么不能这么干」时写出的字符串
   —— 不剥注释就是自打自。 */
import { stripComments } from "./helpers/strip-comments";

const ROOT = resolve(".");
const SOURCES = join(ROOT, ".storybook", "workflow-run-sources.tsx");
const PREVIEW = join(ROOT, ".storybook", "preview.tsx");
const STORY = join(
  ROOT,
  "src",
  "components",
  "studio",
  "logs",
  "TaskLogTimeline.stories.tsx",
);

const sources = readFileSync(SOURCES, "utf8");
const sourcesCode = stripComments(sources);
const preview = readFileSync(PREVIEW, "utf8");
const story = readFileSync(STORY, "utf8");

/**
 * 「这个标识符在**剥了注释**的源码里被**调用**过」。
 *
 * ## 为什么不用 `toContain`
 *
 * `toContain("registerWorkflowRun(")` 会被**顶部的 import**满足 —— 那个名字在
 * `import { registerWorkflowRun, … }` 里也在，于是把调用整行删掉判据照样绿。
 * 本文件的两个变异（去掉 `clearAllWorkflowRuns()`、把三元组调用点改名）都是
 * 这么漏过去的，所以一律走「剥注释 + 排除 import 行 + 真有一次 `名字(`」。
 *
 * 判据是**三次**都在场：① 剥注释之后还有 `名字(`；② 那一行不是 `import … from`
 * 那种声明行；③ 括号配对能走完（不是半截字符串）。
 *
 * 为什么不用「实参非空」判：`clearAllWorkflowRuns()` 本来就**没有**参数，
 * 拿「有没有实参」当「有没有调用」会把它误判成没调用（实测踩过）。
 */
function callsIn(code: string, name: string): boolean {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    /* 取该标识符所在**行**的起点，看这一行是不是 import / export-from 声明。 */
    const lineStart = code.lastIndexOf("\n", m.index) + 1;
    const line = code.slice(lineStart, code.indexOf("\n", m.index));
    if (/^\s*import\b/.test(line)) continue;
    /* 括号配对走完即算「真调用」（不要求实参非空 —— 零参调用也是调用）。 */
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) return true;
      }
    }
  }
  return false;
}

describe("Storybook 工作流运行注入层的契约（ISSUE #1381）", () => {
  it("场景名不认识时抛错，且走真 action 落板", () => {
    expect(sourcesCode).toContain("export const WORKFLOW_RUN_SCENES");
    /* 场景名与其余注入层同一条口径：不认识就抛 —— 静默回退会让「名字写错了」
       在画布上表现成「时间线空着」，而那是看不出对错的形态。 */
    expect(sourcesCode).toContain("运行场景里没有叫");
    /* 登记与追加都必须走真 action：`runs` 是模块私有的 Map，但即便能改，直接写
       也会跳过 `(t, msg)` 去重与 `MAX_LOGS` 截尾 —— 那正是这一层存在的理由。 */
    expect(
      callsIn(sourcesCode, "registerWorkflowRun"),
      "要经 registerWorkflowRun 登记运行（与 use-generation-runner 拿到 taskId 时同一条路）—— 只看名字在场会被 import 那一行满足",
    ).toBe(true);
    expect(
      callsIn(sourcesCode, "appendWorkflowRunLog"),
      "要经 appendWorkflowRunLog 逐条落板 —— 手塞数组会跳过去重与截尾；只看名字在场会被 import 满足",
    ).toBe(true);
  });

  it("失败场景走真入口 failWorkflowRun（横幅与 error 行成对）", () => {
    /* `failWorkflowRun()` 是唯二写 `errorMessage` 的入口，它**同时**把原因补成
       一条 error 日志行 —— 否则用户按级别筛到「错误」时看不到原因。走别的路
       （先 patch 再自己 append 一条）会把这对关系在 story 里重抄一遍。 */
    expect(
      callsIn(sourcesCode, "failWorkflowRun"),
      "要真的调用 failWorkflowRun（只看名字在场会被 import 那一行满足）",
    ).toBe(true);
  });

  it("步骤时刻锚在「现在」，不是写死的日期", () => {
    /* 这条的来由是本批**实测抓到的一处假形态**：第一版把步骤锚在
       `2026-10-05T09:30`，而 `failWorkflowRun()` 补的失败行用它自己的
       `Date.now()` —— 画布上「最后一步 09:30、失败行 18:32」，同一次运行差九个
       多小时。锚在「此刻回推」就没有这个窗口。 */
    expect(
      sources,
      "步骤起点要由 Date.now() 现算 —— 写死日期会让失败行与整条链路差着时区级的时间",
    ).toMatch(/Date\.now\(\)/);
    expect(
      sourcesCode,
      "不许把步骤锚在写死的 ISO 日期上（实测会让失败行落在九个多小时之后）",
    ).not.toMatch(/new Date\("20\d\d-\d\d-\d\dT/);
  });

  it("seed 先清空（故事之间共用一个 module-level store）", () => {
    /* 不清的话上一份故事的时间线会串进这一份，画布上「多出来的那几行」看不出
       是哪来的。清空也顺手让 `seedScene()` 幂等（StrictMode 双调用不产生差异）。 */
    expect(
      callsIn(sourcesCode, "clearAllWorkflowRuns"),
      "要真的调用 clearAllWorkflowRuns() —— 只看名字在场会被 import 那一行满足（本判据自己的一个变异就是这么漏的）",
    ).toBe(true);
  });

  it("装饰器挂在 preview.tsx 的链上（没挂 = parameters 没人读，时间线空着）", () => {
    /* 判的是 `decorators:` 那个**数组里的元素**，不是「文件里出现过这个名字」——
       后者会被 import 那一行满足（`message-center` 那份的实测记录里正是这条
       第一个变异）。所以取 `decorators: [` 到配对 `]` 之间那一段。 */
    const start = preview.indexOf("decorators: [");
    expect(start, "preview.tsx 里找不到 decorators 数组").toBeGreaterThan(-1);
    const end = preview.indexOf("]", start);
    const chain = preview.slice(start, end + 1);
    expect(
      chain,
      "少挂 withWorkflowRunScene = parameters.runScene 没人读，时间线空着",
    ).toContain("withWorkflowRunScene");
  });

  it("story 接真组件，且日志经 store 读而不是直接拿数组", () => {
    expect(story, "story 没 import 真组件").toContain("TaskLogTimeline");
    expect(story).toContain("component: TaskLogTimeline");
    /* 经 store 读末态：`useSyncExternalStore` 三元组就是 `WorkflowRunLogModal`
       里那一份（同一个订阅、同一个快照函数）。

       ## 判的是**调用处**，不是名字在场（这条判据自己的第一个变异）
       第一版写 `expect(story).toContain("getWorkflowRunStoreSnapshot")` —— 实测
       把 story 里那**两处调用**都改名之后判据**照样绿**：上面 import 那两行
       就把名字满足了。这正是本仓反复记着的「拿名字在场当判据」（§12.4），
       所以改成在**剥了注释**的那一份上锚 `useSyncExternalStore(` 的开括号 ——
       从调用点到配对闭括号之间必须真的出现那两个标识符。 */
    const code = stripComments(story);
    const callStart = code.indexOf("useSyncExternalStore(");
    expect(callStart, "story 里找不到 useSyncExternalStore( 调用 —— 改写法了？").toBeGreaterThan(-1);
    /* 括号配对取到这次调用的实参串（第三个参数是服务端快照，同一个函数）。 */
    let depth = 0;
    let callEnd = -1;
    for (let i = code.indexOf("(", callStart); i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          callEnd = i;
          break;
        }
      }
    }
    expect(callEnd, "useSyncExternalStore( 的括号没配对").toBeGreaterThan(callStart);
    const args = code.slice(callStart, callEnd + 1);
    /* 用**标识符边界**匹配，不用 `toContain` —— 后者是子串匹配，把调用点改名成
       `subscribeWorkflowRunStoreX` 之后 `toContain("subscribeWorkflowRunStore")`
       照样成立（这是本判据的第二个变异，实测漏过去过）。 */
    expect(
      args,
      "三元组的订阅函数要是 store 自己的 subscribeWorkflowRunStore",
    ).toMatch(/\bsubscribeWorkflowRunStore\b/);
    expect(
      args,
      "三元组的快照函数要是 store 自己的 getWorkflowRunStoreSnapshot",
    ).toMatch(/\bgetWorkflowRunStoreSnapshot\b/);
  });
});
