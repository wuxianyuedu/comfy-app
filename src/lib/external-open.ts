// ── 「触发一次系统文件对话框之外的外部动作」的唯一出口 ──────────────────────
//
// 按形态扫描时撞出来的账（规范 16 §16.2.4.25）：「打开一个外部目标」这件事
// 在库里散成 **三族写法**，而**结果怎么变成用户可见反馈**各判各的：
//
//   ① **交给系统默认浏览器**（`setting.openExternal` / `comfyOpen` /
//      `dbStudioOpen`）—— 三处的调用点各自拼「调 tRPC → `result.ok ? ok : err`
//      → `catch → errorMessage(error, "…失败")`」这一段样板；
//   ② **打开本机目录**（`comfyapp://` 自定义协议）—— 只有一处，
//      但它带着一段**别处完全没有**的探测逻辑：导航后 2s 内页面失焦视为
//      OS 已接管，否则说明协议助手没注册，必须给出安装引导（防**静默失败**：
//      用户点了「打开目录」什么都没发生，界面也不说为什么）；
//   ③ **触发应用自更新 / 重启**（Tauri updater）—— 结果形状是
//      `{ triggered, detail }`，与 ①② 的 `{ ok, detail }` **字段名不同**，
//      于是每个调用点都得自己记得「这个动作读 `ok`、那个读 `triggered`」。
//
// 也就是说 —— **「动作失败了界面说不说、说什么」取决于动作是从哪个面板发出的**：
// ①② 有反馈通道，而 ② 的失败方式（助手未注册）在别的落点根本不存在这个概念。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（三个结果的形状都合法）。
//
// ## 本模块收什么、不收什么
//
// **收**：外部动作的**目标类型**、**结果归一化**（统一成 `ExternalOpenResult`）、
// 以及「这次调用算不算需要给用户一个说明」的判据。
// **不收**：实际的 IO（tRPC / 协议导航）与状态管理 —— 那些留在
// `use-external-action` 与各自的 controller 里（§18 的分层口径）。
//
// 与 `browser-io.ts` 的分工：那个管「把一段**文本**送出去」（剪贴板 / 下载），
// 本模块管「把**控制权**交给外部程序」（浏览器 / 文件管理器 / 更新器）。

/** 外部动作的目标类别。用于给用户反馈选一个说得清的动词。 */
export type ExternalTarget = "browser" | "folder" | "update" | "relaunch";

/** 各目标的动作名（失败文案里用「<动词>失败」拼出来，不在各处手写）。 */
const TARGET_VERB: Record<ExternalTarget, string> = {
  browser: "在浏览器打开",
  folder: "打开目录",
  update: "检查更新",
  relaunch: "重启应用",
};

/**
 * 外部动作的**统一结果**。
 *
 * 三个来源的形状本来不同（`{ok,detail}` / `{triggered,detail}` / 直接返回
 * `detail`），归一成这一份之后，调用点不必再记得「这个动作读哪个字段」——
 * 那正是三族写法各自记错的地方。
 */
export interface ExternalOpenResult {
  /** 动作是否真的发出去了（不代表外部程序一定成功，见 `detail`）。 */
  ok: boolean;
  /** 给用户看的说明。**成功也带** —— 一句「已交给系统浏览器」是用户唯一
   *  能确认「点了有反应」的证据（硬规则 4：失败路径必须有可见出口）。 */
  detail: string;
}

/** 本机目录打开助手（`comfyapp://` 协议）的接管状态。 */
export type FolderHelperState = "unknown" | "handled" | "missing";

/**
 * 把「服务端 / 更新器返回的任意形状」归一成 {@link ExternalOpenResult}。
 *
 * **归一而不是要求各家改形状**：那三个端点的返回形状有自己的语义
 * （`triggered` 表达的是「安装已触发、应用要重启了」，与「成功」不是同一个
 * 概念），改它们的代价大于在这里收一次。
 */
export function toExternalResult(raw: {
  ok?: boolean;
  triggered?: boolean;
  detail?: string | null;
  error?: string | null;
}): ExternalOpenResult {
  const ok = raw.ok ?? raw.triggered ?? false;
  const detail =
    raw.detail ??
    raw.error ??
    (ok ? "已交给外部程序" : "外部动作未能发起，请重试或手动处理");
  return { ok, detail };
}

/** `「<动词>失败」` —— 失败文案的唯一拼装处。 */
export function externalFailureText(target: ExternalTarget): string {
  return `${TARGET_VERB[target]}失败`;
}

/**
 * 空目标（没地址 / 没路径）时的拦截文案。
 *
 * **必须在发起 IO 之前拦**：`openExternal` 端点的入参是 `z.string().url()`，
 * 传空串会在服务端校验处抛错，界面拿到的是一句 zod 的英文报错
 * （「打开资源失败」+ 一段看不懂的类型信息），而不是「没有可打开的资源地址」。
 * 收口前只有设置页那一条路径做了这层拦截。
 */
export function emptyTargetText(target: ExternalTarget): string {
  switch (target) {
    case "folder":
      return "没有可打开的目录";
    case "update":
      return "没有可安装的更新";
    case "relaunch":
      return "桌面壳未运行，无法重启应用";
    default:
      return "没有可打开的资源地址";
  }
}

/** 目标是否为空（空串 / 全空白 / null）。 */
export function isEmptyTarget(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * 「助手是否注册」的判据：协议导航后，页面在 `windowMs` 内**失去焦点**
 * 视为 OS 已接管（外部程序抢走了焦点）。
 *
 * ⚠️ 这段逻辑此前只有一处写了，而它是**防静默失败**的唯一手段：不判它的话，
 * 「点了打开目录什么都没发生」在界面上与「打开成功」长得一模一样。
 *
 * 返回一个 `settle()`：调用方在超时后调它拿最终状态（`handled` / `missing`）。
 * 放在 `~/lib` 而不是 hook 里，是因为它**不依赖 React** —— 计时窗口与焦点
 * 事件都是浏览器原语，可以脱离组件树单测（`use-external-action` 只是包一层）。
 */
export function detectFolderHelper(
  onHandled?: () => void,
  windowMs = 2000,
): { settle: () => Promise<FolderHelperState> } {
  let handled = false;
  const onBlur = () => {
    if (handled) return;
    handled = true;
    onHandled?.();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("blur", onBlur);
  }
  return {
    settle: () =>
      new Promise<FolderHelperState>((resolve) => {
        if (handled) {
          resolve("handled");
          return;
        }
        /* 已失焦的极端情况（切 tab）在超时后仍按 handled 处理：那是用户
         * 的动作，不该被读成「助手没装」。 */
        setTimeout(() => {
          window.removeEventListener("blur", onBlur);
          resolve(handled ? "handled" : "missing");
        }, windowMs);
      }),
  };
}
