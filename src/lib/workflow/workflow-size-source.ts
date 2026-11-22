// ── 尺寸来源绑定：paramMap 里 `sizeSource` 命名空间的读写（纯模块）──
//
// 有一类图生图工作流不接收尺寸入参：画面尺寸由第一张参考图本身决定。此前
// 数据模型只能表达「尺寸口落到哪一行端口」，表达不了「这个模式的尺寸根本
// 不来自外部入参」，于是封装画布把尺寸卡显示成「未配置」、测试界面照常
// 给一个尺寸选择器、提交时报 `unmatched: size` —— 三处都与真实行为不符。
//
// 这里给作者一个**显式**声明：某个模式的尺寸取自第一张参考图。它挂在
// `paramMap` 的 `sizeSource` 键空间下（与 `referenceLoaders` 同列不同键，
// 权威形状见 `~/lib/workflow/workflow-param-map`），按模式存，与落点线
// 互不影响。不做「有参考图线且没尺寸线就自动推断」的启发式：那会把作者
// 忘了连线误判成设计意图，与映射层「不猜落点」的既有纪律冲突。
//
// 纯函数、无 React、无 IO；编辑画布与载荷/状态派生共用。

import { isPlainRecord } from "~/lib/is-record";
import { MODE_KEY_PREFIX } from "./workflow-param-mapping";

/** 尺寸来源的取值。目前只有一种：第一张参考图。 */
export type SizeSource = "reference-image";

const NAMESPACE = "sizeSource";

/** 某一模式生效的尺寸来源；没有声明（`null`）= 按现有口径由外部尺寸值驱动 / 图内默认值兜底。 */
export function sizeSourceForMode(
  paramMap: unknown,
  mode: string | null | undefined,
): SizeSource | null {
  if (!isPlainRecord(paramMap) || mode === null || mode === undefined || mode === "") {
    return null;
  }
  const namespace = paramMap[NAMESPACE];
  if (!isPlainRecord(namespace)) {
    return null;
  }
  const entry = namespace[`${MODE_KEY_PREFIX}${mode}`];
  if (!isPlainRecord(entry)) {
    return null;
  }
  return entry.from === "reference-image" ? "reference-image" : null;
}

/** 把某个模式的尺寸来源写回 paramMap（不可变返回；`from: null` = 删除该模式的声明）。
 *
 * 只增改 `sizeSource` 命名空间，`source` / `output` / `referenceLoaders` 与其余键
 * 原样保留；模式表清空后连键一起摘掉，不留空壳。 */
export function withSizeSource(args: {
  /** null = 删除这一模式的尺寸来源声明。 */
  from: SizeSource | null;
  mode: string;
  paramMap: unknown;
}): Record<string, unknown> {
  const base = isPlainRecord(args.paramMap) ? { ...args.paramMap } : {};
  const rawNamespace = base[NAMESPACE];
  const namespace = isPlainRecord(rawNamespace) ? { ...rawNamespace } : {};
  const modeKey = `${MODE_KEY_PREFIX}${args.mode}`;
  if (args.from === "reference-image") {
    namespace[modeKey] = { from: "reference-image" };
  } else {
    delete namespace[modeKey];
  }
  if (Object.keys(namespace).length > 0) {
    base[NAMESPACE] = namespace;
  } else {
    delete base[NAMESPACE];
  }
  return base;
}
