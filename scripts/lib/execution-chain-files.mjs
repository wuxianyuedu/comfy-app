/**
 * execution-chain-files.mjs —— 「执行链」这份面的**唯一权威定义**（ISSUE #2914）。
 *
 * ## 为什么收成一处
 *
 * 「执行链」这个词曾经在门禁里没有一处定义：`tests/in-process-event-channel-retired.test.ts`
 * 拿它指一份前缀派生的 17 项（更早是 9 项手抄，#2660 批 2 实测少判 8 份），
 * `tests/dispatch-startup-points.test.ts` 拿它指一份 5 项手抄 —— 同一个词三份地图，
 * 读判据的人会以为「我的模块不叫这几个名字，那条『执行链里不许有 X』就不判我」。
 * 现在两处门禁都 import 本模块，各自取自己那份子集；差异在本文件的注释里**说出口**，
 * 不再靠读的人自己去比对手抄清单。
 *
 * ## 两份面为什么不同（刻意不合并成一份）
 *
 * - **通道面 `CHANNEL_RETIRE_FACE` 要宽**：它服务的是反向断言（「任何模块都不再持有
 *   `EventEmitter`」），少判一份的表现是 `not.toMatch` 恒真 —— 账面读数与「真的退役干净」
 *   逐字相同（假绿，#2660 批 2 实测 9 项手抄少判 8 份）。所以它**从目录派生**：新拆出来的
 *   执行侧模块自动在面里，不靠人记得登记；派生规则本身由
 *   `CHANNEL_RETIRE_EMITTER_ANCHORS` 那五锚点前置断言盯住（规则或文件名漂了 ⇒ 当场红）。
 * - **队列面 `IN_MEMORY_QUEUE_FACE` 要窄**：它判的是「内存队列 / 计数器 / 出队函数不再
 *   长回来」，钉的是**曾经持有过那几样的具体模块**。多列一份的代价只是多一次空判
 *   （那份文件上 `not.toMatch` 本来就该真），无害；漏列一份才是「那一格不再有人判」。
 *   而且 `queue-status.server.ts` 不在通道面的前缀规则里 —— 同一条前缀规则搬到这一格
 *   就会少判一份。所以它是**登记制手抄清单**，每份进面文件下面都带着它为什么进面的理由。
 *
 * ## 新文件该登记进哪份面
 *
 * - 名字命中 `^(executor|runner-state|enqueue|reaper|firstframe)` 的执行侧模块：
 *   **不用登记**，通道面派生规则自动收它；要做的就是别把这五个前缀用歪（派生规则漂移
 *   会被五锚点前置断言当场抓住）。
 * - 只有「曾经持有、或职责上可能再长出内存队列 / 活跃计数器 / 出队函数」的模块才登记进
 *   `IN_MEMORY_QUEUE_FACE`，登记时**必须在条目旁写明它进面的理由**（照下面五条的样子）。
 * - 两份面各管各的命题，**不要为了「统一」把它们合并**：合并成宽面会让队列闸对无关文件
 *   空转，合并成窄面会让通道闸静默缩小 —— 两个方向都是 #2660 批 2 已经实测过的坑。
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMFYUI_DIR = "src/lib/comfyui";

/**
 * 执行链的文件名规则：`executor*` / `runner-state*` / `enqueue` / `reaper` / `firstframe`。
 * 与通道闸逐字同一条；改它之前先读文件头「两份面为什么不同」—— 通道闸的五锚点前置断言
 * 会把规则漂移判红，但**只会点名锚点那份**，不会替你判断新前缀该不该进来。
 */
const EXEC_CHAIN_PATTERN = /^(?:executor|runner-state|enqueue|reaper|firstframe)/;

/**
 * 通道闸的面：**从目录派生**，不是手抄清单。派生逻辑与
 * `tests/in-process-event-channel-retired.test.ts` 逐字同一条（排除 `*.test.*`：
 * 夹具里造一个 `EventEmitter` 是正当写法，不该被那条判红）。
 *
 * @type {readonly string[]} 相对仓库根的 `src/lib/comfyui/<name>` 清单，按字典序。
 */
export const CHANNEL_RETIRE_FACE = Object.freeze(
  readdirSync(path.join(ROOT, COMFYUI_DIR))
    .filter((name) => /\.tsx?$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name))
    .filter((name) => EXEC_CHAIN_PATTERN.test(name.replace(/\.tsx?$/, "")))
    .map((name) => `${COMFYUI_DIR}/${name}`)
    .sort(),
);

/**
 * 历史上真正持有 emitter 的那几份（文件名，不带目录）。通道闸拿它们做前置断言：
 * 它们不在派生面里 = 派生规则或文件名漂了，「任何模块都不再持有 emitter」会变成只判
 * 剩下那几份。
 *
 * @type {readonly string[]}
 */
export const CHANNEL_RETIRE_EMITTER_ANCHORS = Object.freeze([
  "enqueue.ts",
  "executor.ts",
  "runner-state.ts",
  "runner-state-shape.ts",
  "reaper.ts",
]);

/**
 * 派发闸「执行链里没有内存队列 / 计数器 / 出队函数」的面（登记制，每份带理由）。
 *
 * @type {readonly string[]} 相对仓库根的清单。
 */
export const IN_MEMORY_QUEUE_FACE = Object.freeze([
  // 领取循环本体：内存队列时代的**消费端**（过去从队列里取 Job 派发），
  // 队列要长回来最先长在这里。
  "src/lib/comfyui/executor-dispatch.ts",
  // 提交侧入口：内存队列时代的**生产端**（过去直接 push Job 进队列）。
  "src/lib/comfyui/enqueue.ts",
  // 底部状态栏的服务端聚合：今天读库（P3 §5 ADR §14 D1 的 4-B2），此前读的正是
  // `runnerState` 的 `queue` / `startedAt` / `executedWorkflow` / `lastNodeByTask`
  // 四样内存字段；且 `queue-` 前缀不在通道面的派生规则里 —— 它是「两份面不是同一份
  // 地图」的活例，漏登记它，这一格就只剩名字里带 executor / runner-state 的文件。
  "src/lib/comfyui/queue-status.server.ts",
  // 执行层单例运行时状态的持有处：内存队列与活跃计数器（`s.active`）过去的家。
  "src/lib/comfyui/runner-state.ts",
  // RunnerState 类型族与初值工厂：队列 / 计数器字段的**形状出处**，
  // 字段要长回来得先长在这里。
  "src/lib/comfyui/runner-state-shape.ts",
]);
