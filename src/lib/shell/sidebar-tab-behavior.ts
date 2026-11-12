// ── 侧栏项的页签行为（纯函数层：配置形状 + 归一化 + 差集）────────────────────
//
// 主界面侧栏的每一项点开后，是**独立标签页**（常驻，切走不关）还是**共享标签页**
// （切走即关 —— 与既有「瞬时页签」同义），按项配置、落在 JSON 里（ISSUE #3623）。
//
// 三层来源，谁压谁是这一层的全部内容：
//
//   ① 项目默认（`sidebar-tab-defaults.json`，静态 import）—— 跟代码走，随构建走；
//      每个检出与每个桌包都是同一份。改它要走改代码 / 提 PR 那条路。
//   ② 本机覆盖（`data/sidebar-tab-behavior.json`）—— 这台机器上额外改的那点东西，
//      按 `process.cwd()` 锚在应用根。它在而不空才生效，**逐项**压过 ①。
//   ③ 注册表内置标记（`NavItem.transient`）—— 配置面之外的兜底：设置不在侧栏，
//      不进配置面，它「切走即关」是写死在注册表里的。
//
// 生效值 = ② → ① → ③（前者压后者）。
//
// 为什么 ①② 是**逐项**合并而不是「整份压过」：侧栏有九项，用户改一项不该把
// 其余八项的默认一起带走。「整份压过」是模式契约那边的形状（那边存的是一张完整
// 注册表），这边存的是「哪几项被改过」——两边的覆盖语义不同，合并方式也就不同。
//
// 差集化（只落盘真改过的那几项）与模式契约同一条纪律：落盘一份与基准相同的覆盖
// 只会压住基准的演进（「我明明没改它」与「界面把它标成已改」都源于此）。

import { isRecord } from "~/lib/is-record";

import defaultsJson from "./sidebar-tab-defaults.json";

/** 侧栏项的页签行为两档。 */
export type SidebarTabMode = "independent" | "shared";

/** 视图 id → 行为。一份配置是「逐项」的 map，不是整份注册表。 */
export type SidebarTabConfig = Record<string, SidebarTabMode>;

/** 两档行为的界面文案（设置页与说明共用一份，§12.14 端点/文案收口）。 */
export const SIDEBAR_TAB_MODE_LABEL: Record<SidebarTabMode, string> = {
  independent: "独立标签页",
  shared: "共享标签页",
};

/** 值域守卫：只有这两档是合法的，别的（手改坏的 / 旧版本遗留）一律丢弃。 */
function isSidebarTabMode(value: unknown): value is SidebarTabMode {
  return value === "independent" || value === "shared";
}

/**
 * 解析一份配置（非法项丢弃，不抛）。
 *
 * 为什么不抛：这份文件是**可手改**的本机文件（同「模式契约」的覆盖文件），
 * 坏文件不该把整个工作区打成 500 —— 它回落下一层来源，界面照常可用。
 */
export function parseSidebarTabConfig(raw: unknown): SidebarTabConfig {
  if (!isRecord(raw)) {
    return {};
  }
  const out: SidebarTabConfig = {};
  for (const [view, mode] of Object.entries(raw)) {
    if (view === "" || !isSidebarTabMode(mode)) {
      continue;
    }
    out[view] = mode;
  }
  return out;
}

/**
 * 项目默认（静态 import，编译进产物 —— 读到的就是这份快照，与写回侧指向同一份文件）。
 *
 * 它是**完整基线**：配置面内的每一项都显式写在这里，不留「缺省回落」那一层 ——
 * 与「模式契约」项目默认的取向一致（那边自 #3603 起也是完整基线）。
 */
export function projectSidebarTabConfig(): SidebarTabConfig {
  return parseSidebarTabConfig(defaultsJson);
}

/** 逐项合并：override 里的项压过 base 里的同名项（没有的项保留 base 的）。 */
export function mergeSidebarTabConfig(
  base: SidebarTabConfig,
  override: SidebarTabConfig,
): SidebarTabConfig {
  return { ...base, ...override };
}

/**
 * 差集：只留 `desired` 与 `base` 不同的那些项。
 *
 * 与基准相同的项不落盘 —— 「本机覆盖」只记「这台机器上真的改过的那几项」，
 * 于是「改回默认」免费成立（把草稿改回基准再保存 = 从覆盖里消失）。
 */
export function diffSidebarTabConfig(
  desired: SidebarTabConfig,
  base: SidebarTabConfig,
): SidebarTabConfig {
  const out: SidebarTabConfig = {};
  for (const [view, mode] of Object.entries(desired)) {
    if (base[view] !== mode) {
      out[view] = mode;
    }
  }
  return out;
}

/**
 * 某个视图的行为；配置里没有这一项时返回 `undefined` —— 由调用方回落下一层来源。
 *
 * 「取不到就 undefined」而不是「取不到就 independent」：兜底那一层（注册表内置
 * 标记）只对配置面之外的视图有意义，配置面内的项缺了说明文件被手改坏了 ——
 * 两种情形不能混成同一个答案。
 */
export function sidebarTabModeOf(
  view: string,
  config: SidebarTabConfig,
): SidebarTabMode | undefined {
  return config[view];
}

/**
 * 「本机覆盖还在吗」= 生效值与项目默认不一致。
 *
 * 它回答的是**界面该不该给「还原默认」这个出口**（没有改动时给一个点不动的按钮
 * 不如不给）。判据放在纯函数层：它只比两份配置，不碰 IO。
 */
export function isSidebarTabCustomized(
  config: SidebarTabConfig | undefined,
  projectDefaults: SidebarTabConfig | undefined,
): boolean {
  if (!config || !projectDefaults) {
    return false;
  }
  const views = new Set([...Object.keys(config), ...Object.keys(projectDefaults)]);
  for (const view of views) {
    if (config[view] !== projectDefaults[view]) {
      return true;
    }
  }
  return false;
}
