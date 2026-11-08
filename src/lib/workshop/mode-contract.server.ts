// ── 工坊模式契约：服务端存储（规范 §17.2 服务端层）───────────────────────
// 每种模式的统一输入 / 输出是工坊全局口径（本地工作流按它配落点、远端模型按它
// 建适配器）。读这一侧要合**两处**来源，顺序与「谁压谁」是这一层的全部内容：
//
//   ① 成品配置（`model-mode-contract.ts` 的 `CONFIGURED_MODE_CONTRACTS`）——
//      编译进源码的那一份，随构建走、每个检出与每个桌包都是同一份。改它要走
//      改代码 / 提 PR 那条路，这是内置默认**本体**（不再是「没配过时的回落」）。
//   ② 本机覆盖（`data/workshop-mode-contracts.json`）—— 编辑器保存出来的那份，
//      按 `process.cwd()` 锚在应用根。它在而不空才生效，**整份压过** ①。
//
// 为什么覆盖是「整份压过」而不是按模式逐条合并：编辑器保存的是一张完整注册表
// （`saveModeContracts` 归一化后整份写入），而「某模式已从成品配置里删掉、覆盖
// 里还留着」这种情形，按模式合并会让删掉的那个模式复活 —— 用户的原话是
// 「我明明删了它」。整份压或整份不压只有一个判据，也只有一个方向。
//
// 与 `data/` 那条私有目录的关系：本机覆盖落在 `data/` 里正合适 —— 它**就是**
// 「这台机器上额外改的那点东西」，不是随包分发的项目配置。同目录的
// `llm-secret.key`（LLM 主密钥）/ `runtime-secret.json` 是另一类：那是必须留在
// 本机的凭据，被 `standalone-private-inputs.mjs` 按形状剥出分发产物；而本机覆盖
// 不含任何凭据，随不随包都不改变行为（产物里没有编辑入口，读到的也就是成品配置）。

import "server-only";

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";

import {
  MODE_CONTRACTS_REL_PATH,
  MODE_CONTRACT_DEFAULTS_REL_PATH,
} from "./mode-contract-write-path";
import {
  configuredModeContracts,
  parseModeContracts,
  projectDefaultDiff,
  type ModeContract,
} from "./model-mode-contract";

/** 旧落点（契约曾落在**入库的** `config/` 里，ISSUE #1901 那一版）。 */
const LEGACY_CONFIG_REL_PATH = path.join("config", "workshop-mode-contracts.json");

/** 生效的契约注册表：成品配置 + 本机覆盖（覆盖在而不空才整份压过）。
 *
 *  老检出兜底：`config/` 那一版（ISSUE #1901）在那些机器上留下过一份手改的配置，
 *  升到本版后**不该静默丢掉**。所以覆盖不在时按「新落点 → 老落点」依次找一次，
 *  两份都只读不搬（读路径不产生副作用，迁不迁由人决定）。 */
export async function loadModeContracts(
  root: string = process.cwd(),
): Promise<Array<ModeContract>> {
  for (const rel of [MODE_CONTRACTS_REL_PATH, LEGACY_CONFIG_REL_PATH]) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    const override = await readOverrideFile(path.join(root, rel));
    if (override && override.length > 0) {
      return override;
    }
  }
  return configuredModeContracts();
}

/** 保存整份本机覆盖（归一化后覆盖 `data/workshop-mode-contracts.json`）。
 *
 *  「改回成品配置」= 传空数组：`[]` 是「覆盖为空」这个状态本身（`loadModeContracts`
 *  据此回落成品配置），而不是「一台机器上碰巧没有任何契约」—— 契约的清单永远由
 *  成品配置给，空的覆盖不表达任何额外意思。 */
export async function saveModeContracts(
  contracts: Array<ModeContract>,
  root: string = process.cwd(),
): Promise<Array<ModeContract>> {
  const normalized = parseModeContracts(contracts);
  const file = path.join(root, MODE_CONTRACTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch (error) {
    /* 失败必须说出来：「保存了但没落盘」是最坏的形态（用户以为配置生效、
     *  实际下一次读取回到旧值），而它唯一的痕迹就是这里。文案走 `errorText`
     * （动作前缀 + 详情的唯一出口，规范 16 §16.2.4.45），并把**文件路径**带上：
     *  它是这条路唯一能定位的东西。 */
    throw new Error(errorText(error, `模式契约写入失败（${file}）`), {
      cause: error,
    });
  }
  return normalized;
}

/** 读本机覆盖：文件不在或读不出来返回 null（与「读出来是空数组」区分开）。
 *
 *  三种情况合起来按「没有覆盖」处理：① 文件不在（没改过 / 换了机器）；② 内容不是
 *  合法 JSON 或形状不对（手改坏了）。覆盖是**可手改的本机文件**，坏文件不该把工坊
 *  整条链路打成 500 —— 它回落成品配置，界面照常可用。 */
async function readOverrideFile(file: string): Promise<Array<ModeContract> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    return parseModeContracts(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 这份检出是不是**开发检出**（ISSUE #3396 的「非正式版形态」）。
 *
 *  判据与壳的形态判据（规范 §1.5）同一条：检出里有没有启动编排器
 *  `scripts/dev-launcher.mjs`。它同时在 = 源码在手，「保存为项目默认」才有
 *  可写的目标文件；standalone 分发载荷里没有编排器，这一格必为 false。 */
export function isDevCheckout(root: string = process.cwd()): boolean {
  return existsSync(path.join(root, "scripts", "dev-launcher.mjs"));
}

/** 把「当前编辑的契约」里与推导**有差异**的部分写进入库的项目默认
 *  （`src/lib/workshop/mode-contract-defaults.json`，跟代码走）。
 *
 *  只有开发检出可以调：正式包没有源码可写，这格调用本身就是错用 —— 大声失败
 *  而不是假装成功。写的是 `projectDefaultDiff` 的差集（与推导相同的模式不写），
 *  未显式覆盖的模式继续跟随推导演进；写完后读取侧（静态 import 的那份快照）
 *  要**重启进程**才会变 —— 返回值里把这一点说清，由界面转告。 */
export async function saveModeContractsAsProjectDefaults(
  contracts: Array<ModeContract>,
  root: string = process.cwd(),
): Promise<{ contracts: Array<ModeContract>; file: string }> {
  if (!isDevCheckout(root)) {
    throw new Error(
      "保存为项目默认只在开发检出可用（这份检出里没有 scripts/dev-launcher.mjs）——" +
        "正式包的契约改动请用「保存模式契约」（只落本机）。",
    );
  }
  const normalized = parseModeContracts(contracts);
  const diff = projectDefaultDiff(normalized);
  const file = path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(diff, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(errorText(error, `项目默认写入失败（${file}）`), { cause: error });
  }
  return { contracts: diff, file };
}
