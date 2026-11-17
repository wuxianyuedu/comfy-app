// ── 侧栏页签行为：服务端存储（规范 §17.2 服务端层）──────────────────────────
//
// 「工作区的全局视图点开后是独立标签页还是共享标签页」（ISSUE #3623 / #3798）有三层落点，
// 与「模式契约」同一套形状：
//
//   ① 编译进包的默认值（`src/lib/shell/sidebar-tab-defaults.json`）—— **静态 import
//      的编译源**（`projectSidebarTabConfig()` 读的就是它），随构建走、每个检出与
//      每个桌包都是同一份。改它要走改代码 / 提 PR 那条路；**运行期不写它**
//      （ISSUE #4150：运行期写 src 的代价是工作树常挂 M + dev 下 Turbopack 模块图
//      失效、服务端模块内存态随旧实例变孤儿）。
//   ② 本机项目默认覆盖（`data/sidebar-tab-project-defaults.json`）—— 界面里点
//      「保存为项目默认」写出来的那份（整份、全量配置），落在本机运行期目录。
//      它在而不空才作为基线，压过 ①；不随 git 走。
//   ③ 本机覆盖（`data/sidebar-tab-behavior.json`）—— 编辑器「一档即存」写出来的
//      那份，**逐项差集**压过基线（②或①，谁在用谁）。
//
// 为什么覆盖是「逐项压过」而不是「整份压过」：③存的是「哪几项被改过」，
// 整份压过会把没改过的项一起带走。模式契约那边存的是一张完整注册表，所以那边
// 的覆盖是整份压 —— 两边的覆盖语义不同，合并方式也就不同。
//
// 与 `data/` 那条私有目录的关系：②③都落在 `data/` 里正合适 —— 它们**就是**
// 「这台机器上额外改的那点东西」，不是随包分发的项目配置（同目录的
// `llm-secret.key` / `runtime-secret.json` 是另一类：那是必须留在本机的凭据）。
// 分发产物里没有这些文件（按运行期路径读，不进 file tracing），出厂件读到的
// 就是编译进包的那份。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import { AsyncMutex } from "~/lib/async-mutex";
import { logger } from "~/lib/core/logger";
import { migrateLegacyDefaultsFile } from "~/lib/core/defaults-legacy-migration.server";
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

/** 本机项目默认覆盖的落点（ISSUE #4150）：「保存为项目默认」的运行期写入落这里，
 *  不入库。与 {@link SIDEBAR_TAB_DEFAULTS_REL_PATH} 的分工：那份只剩编译期默认值
 *  （静态 import 的编译源，改它走代码 / PR），这份是「这台机器上点过『保存为项目
 *  默认』的那份全量基线」。 */
export const SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH = path.join(
  "data",
  "sidebar-tab-project-defaults.json",
);

/** 编译进包的默认值落点 —— 静态 import 的编译源（`sidebar-tab-behavior.ts` 引它），
 *  **运行期不再写它**。本常量现仅服务存量迁移的判据（旧版把「保存为项目默认」
 *  写在这里，遗留的用户态要搬去 {@link SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH}）。 */
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

/** 项目默认基线（跟代码走的默认值 + 本机「保存为项目默认」的覆盖，谁在用谁）：
 *  设置页要拿它当「还原默认」的基准与差集基准。
 *
 *  读链（ISSUE #4150 收口）：先本机运行时覆盖（`data/`），缺省回落编译进包的
 *  快照 —— 不再读 src 那份文件（它与快照在提交态下逐字节同源，读它只会把
 *  「运行期写 src」的旧病带回读链）。 */
export async function loadSidebarTabProjectDefaults(
  root: string = process.cwd(),
): Promise<SidebarTabConfig> {
  const runtimeFile = path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH);
  /* 存量搬迁：旧版把「保存为项目默认」直接写进 src，遗留的用户态搬去新落点
   * （详见 defaults-legacy-migration.server —— 与快照一致时不迁移）。 */
  const migrated = await migrateLegacyDefaultsFile({
    srcFile: path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH),
    runtimeFile,
    snapshot: projectSidebarTabConfig(),
  });
  if (migrated) {
    logger.info(
      `[shell] 已把旧版写进 src 的侧栏页签项目默认迁到 ${SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH}` +
        "（src 里的那份回归编译源，遗留的工作树改动可 git checkout -- 收掉）",
    );
  }
  try {
    const raw = await fs.readFile(runtimeFile, "utf8");
    return parseSidebarTabConfig(JSON.parse(raw));
  } catch {
    /* 本机覆盖读不出来（没有 / 手改坏了）：回落编译进包的那份快照。 */
    return projectSidebarTabConfig();
  }
}

/** 覆盖文件的写方先进进程内互斥（ISSUE #3859）：「读基准 → 差集 → 整份写回」
 *  并发交叠时，后写者会用旧基准顶掉先写者。 */
const overrideFileMutex = new AsyncMutex();

/** 覆盖文件的原子写（ISSUE #3859）：tmp + rename，读侧不会撞到半截 JSON。 */
async function atomicWriteText(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
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
  const file = path.join(/*turbopackIgnore: true*/ root, SIDEBAR_TAB_LOCAL_REL_PATH);
  return overrideFileMutex.run(async () => {
    const project = await loadSidebarTabProjectDefaults(root);
    const diff = diffSidebarTabConfig(parseSidebarTabConfig(config), project);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteText(file, `${JSON.stringify(diff, null, 2)}\n`);
    } catch (error) {
      /* 失败必须说出来：「保存了但没落盘」是最坏的形态（用户以为配置生效、
       * 实际下一次读取回到旧值），而它唯一的痕迹就是这里。文案走 `errorText`
       * （动作前缀 + 详情的唯一出口，规范 16 §16.2.4.45），并把**文件路径**带上：
       * 它是这条路唯一能定位的东西。 */
      throw new Error(errorText(error, `侧栏页签行为写入失败（${file}）`), { cause: error });
    }
    return diff;
  });
}

/**
 * 把「当前编辑的配置」**全量**写进本机项目默认覆盖（`data/`，ISSUE #4150）。
 *
 * 只有开发检出可以调：这格是出厂默认流程的开发期入口（正式包的改动请改一档
 * 即存，只落本机覆盖）。写完后读取侧现读运行时文件 ⇒ **不必重启进程**即生效；
 * 要让改动进出厂默认，改 `src/lib/shell/sidebar-tab-defaults.json` 走 PR
 * （那份是编译源，运行期不写它）。
 */
export async function saveSidebarTabConfigAsProjectDefaults(
  config: SidebarTabConfig,
  root: string = process.cwd(),
): Promise<{ config: SidebarTabConfig; file: string }> {
  if (!isDevCheckout(root)) {
    throw new Error(
      "保存为项目默认只在开发检出可用——" + "正式包的改动请改一档即存（只落本机覆盖）。",
    );
  }
  const full = parseSidebarTabConfig(config);
  const file = path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, `${JSON.stringify(full, null, 2)}\n`);
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
