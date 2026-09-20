// ── 「把一次异步动作的结果接到反馈通道上」的唯一出口（规范 16 §16.2.4.30）────
//
// 按**形态**扫描时撞出来的账：「置忙 → 调用 → 成功一句 / 失败一句 → finally 清忙」
// 这段样板在全库有二十余处各写一遍，而它对三件事各判各的：
//
//   ① **失败文案从哪来** —— 有的走 `errorMessage(e, "保存失败")`（设置页、
//      工作流库、模型标签），有的只写一句写死的 `toast.error("删除失败")`
//      （历史列表），有的把 `e instanceof Error ? e.message : String(e)`
//      再抄一遍（`use-workflow-persistence` 的位置保存、封装测试表单）。
//      三者的用户可见结果是**不同的**：同一句「网络请求失败」在一种写法下能
//      落到用户眼前、在另一种下只剩「保存失败」四个字。
//   ② **反馈通道是谁** —— 设置页用整页提示条（带 `ok`/`err` 两态语义）、
//      历史详情与工作流库用 toast（`success` / `error` 两个方法）、
//      模型标签与训练工作室用一块行内 `setError(string)`、工坊管线用
//      `setNotice(string)`。**这是调用处的表现层选择，不是本模块的判据** ——
//      所以通道由调用处注入。
//   ③ **成功要不要说** —— 有的成功有文案（「已保存」「已删除任务」），
//      有的成功**一句话都不说**（历史详情的打开目录、路径复制走 toast.success
//      是特例），还有的成功文案是**动作结果的函数**（`result.ok ? "ok" : "err"`
//      配服务端返回的 `detail`）。这条差别最容易漏：成功静默与成功报错
//      在代码上都是「没有 catch」，看起来一样。
//
// 也就是说 —— **「这个动作失败了界面说不说、说什么」取决于它是哪一处写的**。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（两种写法都合法）。
//
// 与 `~/lib/external-open` / `~/components/ui/use-external-action` 的分工：
// 那一对管的是「把控制权交给**外部程序**」（浏览器 / 文件管理器 / 更新器），
// 本模块管的是「任何一次异步动作的结果怎么变成用户可见反馈」——
// 包括 tRPC 调用、上传、下载、读文件。外部动作是本模块的一个特例
// （它的失败文案由目标类别给出，见 `externalFailureText`）。
//
// ## 收什么、不收什么
//
// **收**：结果归一（成功 / 失败 / 失败文案）、反馈通道的调用形状、
// 「失败路径必须有可见出口」这条硬规则的落点。
// **不收**：忙标记（那是 React 状态，归调用处或 `useAsyncAction`）、
// 日志（归 `~/lib/log`）、实际 IO（归各自的 domain client）。

import { errorMessage } from "~/lib/error-message";

/**
 * 一次异步动作的**反馈通道**。
 *
 * `kind` 只留两态：`"ok"` / `"err"`。通道的形态由调用处决定 ——
 * 设置页把它接到整页提示条（同一个 `showFlash`），历史详情与工作流库接到
 * toast（成功调 `toast.success`、失败调 `toast.error`，两行第二参数由调用处
 * 决定），行内错误块接到 `setError`，工坊管线接到 `setNotice`。
 *
 * **为什么不让通道自己带标题**：收口前每处都是「一句手写的标题 + 一句
 * `errorMessage` 的详情」两个参数，而标题恰恰是最不该被复制的那一半
 * （「更新模式失败」在各处逐字重复四遍）。所以 `report` 收**一句已经拼好的
 * 文案**，标题归调用处的 `failureText` / `successText`。
 */
export type ActionReport = (kind: "ok" | "err", detail: string) => void;

/** 一次异步动作的执行结果（给调用处继续用，如回滚 / 刷新）。 */
export interface ActionResult {
  /** 动作是否成功（含「返回了失败信封」这一种，见 `toActionResult`）。 */
  ok: boolean;
  /** 用户可见文案：成功时是成功文案，失败时是失败文案。 */
  detail: string;
}

/**
 * 动作返回的原始形状 —— 各来源的并集。
 *
 * 除了三种信封（`{ok,detail}` / `{triggered,detail}` / 布尔）之外，
 * **`object` 这一支不能省**：tRPC 的 mutation 会返回业务对象
 * （`{ template: … }` / `{ id, name, … }`），那既不是信封也不是 `void` ——
 * 把它排除在外会逼着每个调用处写 `async () => { await …; }` 把返回值吞掉。
 * 出口对它的读法是「没有 `ok` / `triggered` 字段 → 不抛即成功」，
 * 与 `void` 同口径。
 */
/* 用 `unknown` 而不是 `boolean | void | null | object` 的联合：动作的返回
 * 类型在调用处常常是 `Promise<unknown>`（tRPC mutation 的 `await` 结果被
 * TS 收窄成 unknown 的落点不少），而出口对它的读法是**运行时**判形状
 *（有没有 `ok` / `triggered` 字段），不是编译期。收窄成联合会让每个这样
 * 的调用处都被迫写一次类型断言 —— 那是一层不带来任何检查的噪声。 */
export type RawActionResult = unknown;

export interface RunAsyncActionOptions {
  /** 反馈通道（必给 —— 这就是本模块存在的理由）。 */
  report: ActionReport;
  /**
   * 失败文案的**标题**（详情由 `errorMessage` 从抛出的值里取）。
   *
   * 收口前这一句在每个落点手写一遍，且**同一条账里有两种写法**：
   * 「动作名 + 失败」（`"更新模式失败"`）与光秃秃的 `"删除失败"`。
   * 后者在用户看到时缺少「删除的是什么」，所以这里要求调用处显式给出。
   * 可以给函数（文案依赖入参时，如「删除「<名字>」失败」）。
   */
  failureText: string | (() => string);
  /**
   * 成功文案。**不给 = 成功静默**（这是合法的，但要显式写出来：
   * 见 {@link runAsyncAction} 的注释）。
   *
   * 收口前「成功静默」与「忘了写成功分支」在代码上长得一模一样 ——
   * 参数缺席时这条差别才被真正表达出来。
   */
  successText?: string | ((result: ActionResult) => string);
  /**
   * 结果信封的**成功判据**。给 `false` 时本模块不再看返回值，
   * 只按「有没有抛」判定（用于端点在响应体里带 `ok: false` 的落点）。
   */
  readResultEnvelope?: boolean;
}

/** 取文案：字面量直接用，函数按调用期求值（文案依赖入参时用函数形式）。 */
function text(value: string | (() => string)): string {
  return typeof value === "function" ? value() : value;
}

/**
 * 把「任意形状的返回结果」归一成 {@link ActionResult}。
 *
 * **归一而不是要求各家改形状**：`{ ok, detail }`（本应用 REST 路由）、
 * `{ triggered, detail }`（更新器）、直接返回 `void`（tRPC mutation）、
 * 返回 `boolean`（`copyText` 这类）四种都在用，改它们的代价大于在这里收一次。
 * 判据与 `~/lib/external-open` 的 `toExternalResult` 同源（`ok ?? triggered ?? false`）——
 * 但那个模块的 `detail` 有「已交给外部程序」这类**外部动作专属**的兜底文案，
 * 所以两份仍然分开：合成一份会让「外部动作」这个概念漏进通用动作层。
 */
export function toActionResult(
  raw: RawActionResult,
  fallbackDetail: string,
): ActionResult {
  if (raw === true) return { ok: true, detail: fallbackDetail };
  if (raw === false) return { ok: false, detail: fallbackDetail };
  if (raw === null || raw === undefined) {
    /* `void` 返回值：tRPC 这类「不抛就是成功」的端点。 */
    return { ok: true, detail: fallbackDetail };
  }
  /* 普通对象（业务返回值）按「不抛即成功」读；只有真的带了 `ok` /
   * `triggered` 字段时才按信封判 —— 与 `void` 同口径。 */
  const envelope = raw as {
    ok?: boolean;
    triggered?: boolean;
    detail?: string | null;
    error?: string | null;
  };
  const ok = envelope.ok ?? envelope.triggered ?? true;
  const detail = envelope.detail ?? envelope.error ?? fallbackDetail;
  return { ok, detail };
}

/**
 * 跑一次异步动作，并把结果接到反馈通道上。
 *
 * ## 三件本函数一次给全的事
 *
 * 1. **失败路径一定有可见出口**（硬规则 4）：`catch` 里统一走
 *    `errorMessage(e, failureText())` —— 网络层原文（「Unexpected token '<'」）
 *    由 `~/lib/error-message` 翻译成人话，调用处不必再判一次。
 *    `finally` 里清忙由调用处负责（忙标记是它的状态）。
 * 2. **成功静默是显式的**：`successText` 缺席 = 成功不报（合法），
 *    给了就一定会报 —— 收口前那二十余处里，「成功静默」与「忘了写成功分支」
 *    在代码上完全一样。
 * 3. **结果信封按同一口径读**：`ok ?? triggered ?? true`（第三种来源
 *    tRPC 不抛即成功）。`readResultEnvelope: false` 则完全不看返回值。
 *
 * ## 返回值而不是抛错
 *
 * 失败**不向外抛**：调用处大多需要「失败了就回滚本地乐观更新 / 刷新列表」，
 * 那需要一个返回值而不是一个需要再包一层 try 的异常（收口前
 * `patchModes` / `patchModelTags` 正是这么写的，而 `resyncWorkflow`
 * 那个漏了回滚 —— 差别只在「有没有再包一层」）。
 *
 * 典型调用形态（成功报 toast、失败回滚列表）：
 * 先给出 `report`（成功调 `toast.success`、失败调 `toast.error`），
 * 再 `await runAsyncAction(发起调用的箭头函数, { report, failureText, successText })`
 * —— 它返回的 `{ ok, detail }` 用来决定要不要 `void load()` 回滚列表。
 * 完整示例见 `use-workflow-actions` 的 `patchModes`。
 */
export async function runAsyncAction(
  action: () => Promise<RawActionResult>,
  {
    report,
    failureText,
    successText,
    readResultEnvelope = true,
  }: RunAsyncActionOptions,
): Promise<ActionResult> {
  try {
    const raw = await action();
    if (!readResultEnvelope) {
      const detail =
        typeof successText === "function"
          ? successText({ ok: true, detail: "" })
          : (successText ?? "");
      if (detail) report("ok", detail);
      return { ok: true, detail };
    }
    /* 信封的成功判据在这里读一次：`{ok:false}` / `{triggered:false}`
     * 这类「不抛但也没做成」的返回，收口前有的被读成功、有的被读失败。 */
    const result = toActionResult(raw, "");
    if (result.ok) {
      /* 成功文案的优先级：`successText`（调用处手写的）→ 信封里的 `detail`
       *（服务端说的，如「已启动」）→ 什么都不报（成功静默）。
       * 中间那一档是必须的：`{ ok: true, detail: "已启动" }` 这类信封的
       * `detail` 是端点自己探出来的结论，调用处不该把它抄一遍。 */
      const detail =
        typeof successText === "function"
          ? successText(result)
          : (successText ?? result.detail);
      if (detail) report("ok", detail);
      return { ok: true, detail: detail ?? "" };
    }
    /* 服务端给了 `detail` / `error` 就用它（它比标题更能说明原因），
     * 没给才回落标题。与 `toActionResult` 的兜底同源。 */
    const detail = result.detail || text(failureText);
    report("err", detail);
    return { ok: false, detail };
  } catch (error) {
    const detail = errorMessage(error, text(failureText));
    report("err", detail);
    return { ok: false, detail };
  }
}
