// ── 侧栏页签行为：服务端存储（规范 §17.2 服务端层）──────────────────────────
//
// 「工作区的全局视图点开后是独立标签页还是共享标签页」（ISSUE #3623 / #3798）有两层落点，
// 与「模式契约」同一套形状：
//
//   ① 项目默认（`src/lib/shell/sidebar-tab-defaults.json`）—— 编译进源码的**完整
//      基线**（配置面内的每一项都显式在文件里），随构建走、每个检出与每个桌包都是
//      同一份。改它要走改代码 / 提 PR 那条路。
//   ② 本机覆盖（`data/sidebar-tab-behavior.json`）—— 编辑器保存出来的那份，按
//      `process.cwd()` 锚在应用根。它在而不空才生效，**逐项**压过 ①。
//
// 为什么覆盖是「逐项压过」而不是「整份压过」：这边存的是「哪几项被改过」
// （差集化后落盘），整份压过会把没改过的项一起带走。模式契约那边存的是一张完整
// 注册表，所以那边是整份压 —— 两边的覆盖语义不同，合并方式也就不同。
//
// 与 `data/` 那条私有目录的关系：本机覆盖落在 `data/` 里正合适 —— 它**就是**
// 「这台机器上额外改的那点东西」，不是随包分发的项目配置（同目录的
// `llm-secret.key` / `runtime-secret.json` 是另一类：那是必须留在本机的凭据）。
// 分发产物里没有这个文件（它按运行期路径读，不进 file tracing），出厂件读到的
// 就是项目默认。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";

import {
  diffSidebarTabConfig,
  mergeSidebarTabConfig,
  parseSidebarTabConfig,
  projectSidebarTabConfig,
  type SidebarTabConfig,
} from "./sidebar-tab-behavior";

/** 本机覆盖相对**仓库根**（= 运行期的 `process.cwd()`）的路径。 */
export const SIDEBAR_TAB_LOCAL_REL_PATH = "data/sidebar-tab-behavior.json";

/** 项目默认显式覆盖 —— 相对**仓库根**的路径，入库、跟代码走。
 *
 *  与 {@link SIDEBAR_TAB_LOCAL_REL_PATH} 的分工：那份是「这台机器上的额外改动」
 *  （不入库），这份是「界面里点『保存为项目默认』写出来的默认」（提交后每个检出
 *  与每个桌包都是它）。只有开发检出有写它的入口（正式包载荷里没有源码）。 */
export const SIDEBAR_TAB_DEFAULTS_REL_PATH = "src/lib/shell/sidebar-tab-defaults.json";

/** 生效配置：项目默认 + 本机覆盖（覆盖逐项压过默认）。
 *
 *  项目默认先从**磁盘**读、读不出来回落编译进来的那份快照 —— 两处读到的必须是同一
 *  份内容，否则「保存为项目默认」之后的两条路（生效值 / 差集基准）会各说各话
 *  （正式包里磁盘上没有源码，回落快照正是它该走的路）。
 *
 *  坏文件按「没有覆盖」处理：这份文件是**可手改**的本机文件，坏文件不该把整个
 *  工作区打成 500 —— 它回落项目默认，界面照常可用（与模式契约那条同纪律）。 */
export async function loadSidebarTabConfig(
  root: string = process.cwd(),
): Promise<SidebarTabConfig> {
  const [project, override] = await Promise.all([
    loadSidebarTabProjectDefaults(root),
    readLocalOverride(path.join(/*turbopackIgnore: true*/ root, SIDEBAR_TAB_LOCAL_REL_PATH)),
  ]);
  return mergeSidebarTabConfig(project, override);
}

/** 项目默认那份（跟代码走的那份）：设置页要拿它当「还原默认」的基准与差集基准。 */
export async function loadSidebarTabProjectDefaults(
  root: string = process.cwd(),
): Promise<SidebarTabConfig> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIDEBAR_TAB_DEFAULTS_REL_PATH);
  try {
    const raw = await fs.readFile(file, "utf8");
    return parseSidebarTabConfig(JSON.parse(raw));
  } catch {
    /* 项目默认读不出来（手改坏了 / 正式包里没有源码）：回落编译进来的那份快照。 */
    return projectSidebarTabConfig();
  }
}

/**
 * 保存本机覆盖（差集化后覆盖 `data/sidebar-tab-behavior.json`）。
 *
 * 差集化：与项目默认相同的项**不落盘** —— 覆盖文件里只留「这台机器上真的改过的那
 * 几项」。于是「改回默认」免费成立（把草稿改回基准再保存 = 从覆盖里消失）。
 * 返回**落盘的**那份（差集），调用方拿它刷新界面。
 */
export async function saveSidebarTabConfig(
  config: SidebarTabConfig,
  root: string = process.cwd(),
): Promise<SidebarTabConfig> {
  const project = await loadSidebarTabProjectDefaults(root);
  const diff = diffSidebarTabConfig(parseSidebarTabConfig(config), project);
  const file = path.join(/*turbopackIgnore: true*/ root, SIDEBAR_TAB_LOCAL_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(diff, null, 2)}\n`, "utf8");
  } catch (error) {
    /* 失败必须说出来：「保存了但没落盘」是最坏的形态（用户以为配置生效、
     * 实际下一次读取回到旧值），而它唯一的痕迹就是这里。文案走 `errorText`
     * （动作前缀 + 详情的唯一出口，规范 16 §16.2.4.45），并把**文件路径**带上：
     * 它是这条路唯一能定位的东西。 */
    throw new Error(errorText(error, `侧栏页签行为写入失败（${file}）`), { cause: error });
  }
  return diff;
}

/**
 * 把「当前编辑的配置」**全量**写进入库的项目默认（跟代码走的那份 JSON）。
 *
 * 只有开发检出可以调：正式包没有源码可写，这格调用本身就是错用 —— 大声失败而不是
 * 假装成功。写完后读取侧（静态 import 的那份快照）要**重启进程**才会变。
 */
export async function saveSidebarTabConfigAsProjectDefaults(
  config: SidebarTabConfig,
  root: string = process.cwd(),
): Promise<{ config: SidebarTabConfig; file: string }> {
  if (!isDevCheckout(root)) {
    throw new Error(
      "保存为项目默认只在开发检出可用（这份检出里没有 scripts/dev-launcher.mjs）——" +
        "正式包的改动请用「保存」（只落本机）。",
    );
  }
  const full = parseSidebarTabConfig(config);
  const file = path.join(/*turbopackIgnore: true*/ root, SIDEBAR_TAB_DEFAULTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(errorText(error, `项目默认写入失败（${file}）`), { cause: error });
  }
  return { config: full, file };
}

/**
 * 还原默认：删掉本机覆盖（生效值回落项目默认）。
 *
 * 覆盖文件**不在时不动**（本来就没有「这台机器的改动」，还原无事可做 —— 读路径
 * 不产生副作用的同一条纪律，别让一次「还原」把空覆盖钉进本机）。
 */
export async function resetSidebarTabConfig(
  root: string = process.cwd(),
): Promise<SidebarTabConfig> {
  const file = path.join(/*turbopackIgnore: true*/ root, SIDEBAR_TAB_LOCAL_REL_PATH);
  try {
    await fs.rm(file, { force: true });
  } catch (error) {
    throw new Error(errorText(error, `侧栏页签行为还原失败（${file}）`), { cause: error });
  }
  return loadSidebarTabConfig(root);
}

/** 读本机覆盖：文件不在或读不出来返回空配置（与「读出来是空对象」不区分 —— 空
 *  覆盖与没有覆盖的生效结果一样，逐项合并后都是「什么都没改」）。 */
async function readLocalOverride(file: string): Promise<SidebarTabConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return {};
  }
  try {
    return parseSidebarTabConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}
