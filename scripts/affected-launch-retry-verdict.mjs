/**
 * affected-launch-retry-verdict.mjs —— 组 C 隔离复跑的**判决粒度**。
 *
 * 立案现场（ISSUE #2225）：复跑面早就做到**按文件**了（`retryScope` 只重跑
 * 第 1 遍里失败的那几份），而判决停在**按块** —— 第 2 遍仍红时，代码问的是
 * `isTimeoutShaped(retry.output)`，那一句读的是整块输出。于是同一块里
 * 「A 文件超时 + B 文件真断言红」被整块读成「只是超时形态」⇒ **退 0**，
 * 而 `scripts/ci-affected-tests.mjs` 把这个 0 原样透传成平台 stage 的 success。
 * 它自己的话术写着「这不是绿」，屏幕下方也确实逐条点名了 —— 但退出码是 0，
 * 而**平台只读退出码**。判定粒度比取数粒度粗，粗的那一份就把细的那一份的真红吞了。
 *
 * ## 这一层只回答一件事：第 2 遍那一次红，按文件分开之后是什么
 *
 * 三种结论，各配一个**互不相同**的退码档（由调用点 `runChunk` 落成退出码）：
 *
 * | 结论                | 判据                                                       | 调用点动作                        |
 * | ------------------- | ---------------------------------------------------------- | --------------------------------- |
 * | `hard-fail`       | 至少一份文件的失败文本**不带**超时指纹（真断言 / 真挂死） | 阻断，并点名那几份                |
 * | `unverified`      | 每一份失败文件都带超时指纹                                | 放行 + 逐条点名（沿用 #1747 口径）|
 * | `unattributed`    | 有失败文件拿不到自己的读数（junit 缺 / 形状不认识）        | **不再冒充**「整块只是超时形态」  |
 *
 * `unattributed` 是这次新增的那一档，也是这条 bug 的正身：**「我分不出哪份是超时」
 * 不等于「整块都只是超时」**。它的处置由调用点决定（有界逐文件复跑拿回粒度，拿不回来
 * 就退 2 —— 构成结论，但不是红，见规范 §13.6.4.1），这一层只负责把它和另两种分开，
 * 并且**永不**把它并进 `unverified`（那等于把「粒度不够」洗成「已确认没断言报错」）。
 *
 * 指纹清单沿用 `affected-launch-load-retry.mjs` 的那一份（与 `base-check/verdict.mjs`
 * 同源，由 `tests/hook-affected-launch.test.ts` 逐条核对不漂移）—— 这里不抄第二份。
 */
import { isTimeoutShaped } from "./affected-launch-load-retry.mjs";

/**
 * 第 2 遍的读数按文件分开。
 *
 * @param {{files: string[], readSuites?: {name: string, body: string}[]}} input
 *  `files` 是这次复跑的清单，`readSuites` 是那一次的 junit 失败 suite（带各自文本）。
 * @returns {{kind: "unverified" | "unattributed" | "hard-fail", timedOut: string[], hardFail: string[], unknown: string[]}}
 *   `timedOut` / `hardFail` / `unknown` 只在**判得出来**时填；`kind` 是结论档位。
 */
export function classifyRetry(input) {
  const files = Array.isArray(input.files) ? input.files : [];
  const readSuites = Array.isArray(input.readSuites) ? input.readSuites : [];
  /** @type {Map<string, string>} */
  const bodyByName = new Map();
  for (const s of readSuites) {
    // 同一份文件出现多个失败 suite 时把文本并起来：指纹只要出现一次就够。
    const prev = bodyByName.get(s.name) ?? "";
    bodyByName.set(s.name, `${prev}\n${s.body ?? ""}`);
  }
  /** @type {string[]} */
  const timedOut = [];
  /** @type {string[]} */
  const hardFail = [];
  /** @type {string[]} */
  const unknown = [];
  for (const f of files) {
    const body = bodyByName.get(f);
    if (body === undefined) {
      // 复跑退出码非零，而这份文件在 junit 里没有失败读数 ⇒ 它的红归不到它自己身上，
      // 也**不能**替它宣布「只是超时」。
      unknown.push(f);
      continue;
    }
    if (isTimeoutShaped(body)) timedOut.push(f);
    else hardFail.push(f);
  }
  const kind =
    hardFail.length > 0
      ? "hard-fail"
      : unknown.length > 0
        ? "unattributed"
        : "unverified";
  return { kind, timedOut, hardFail, unknown };
}

/**
 * 把「一份一次 spawn」的那些补跑并回判决（调用点是 `runChunk`，它起进程）。
 *
 * 存在的理由：`unattributed` 那一档不能停在「我分不出」。一份文件自己跑、自己一个退出码，
 * 那份退出码**就是**它的结论 —— 不需要再解析任何东西，也就不会把「解析失败」伪装成「没失败」。
 * 代价是每份一次进程启动，所以调用点必须**有界**（份数超过上限就别再补，把 `unknown` 留着），
 * 而补跑只在「第 2 遍仍红且分不出」这条稀有路径上发生 —— 绿的那一档一个字都不多跑。
 *
 * 补跑自己通过（退 0）的那一份记进 `green`：它既不是超时也不是真红，
 * 而**不许**把它算进 `unverified` 的点名名单（那份名单会被下一个人拿去重跑，
 * 点名一份已经绿的文件就是在谎报覆盖面 —— 同 `retryScope` 里「复跑面只往多跑偏」那条）。
 *
 * @param {{kind: string, timedOut: string[], hardFail: string[], unknown: string[]}} verdict
 * @param {{file: string, status: number | null, output: string}[]} perFile
 * @returns {{kind: "unverified" | "unattributed" | "hard-fail", timedOut: string[], hardFail: string[], unknown: string[], green: string[]}}
 */
export function mergePerFileReads(verdict, perFile) {
  /** @type {string[]} */
  const timedOut = [...verdict.timedOut];
  /** @type {string[]} */
  const hardFail = [...verdict.hardFail];
  /** @type {string[]} */
  const unknown = [...verdict.unknown];
  /** @type {string[]} */
  const green = [];
  for (const one of perFile) {
    const at = unknown.indexOf(one.file);
    if (at !== -1) unknown.splice(at, 1);
    if (one.status === 0) green.push(one.file);
    else if (isTimeoutShaped(one.output)) timedOut.push(one.file);
    else hardFail.push(one.file);
  }
  const kind =
    hardFail.length > 0
      ? "hard-fail"
      : unknown.length > 0
        ? "unattributed"
        : "unverified";
  return { kind, timedOut, hardFail, unknown, green };
}
