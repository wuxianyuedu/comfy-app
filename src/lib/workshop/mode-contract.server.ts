// ── 工坊模式契约注册表：服务端存储（**随 git 走的项目配置**，规范 §17.2 服务端层）──
// 每种模式的统一输入 / 输出是工坊全局配置（本地工作流按它配落点、远端模型
// 按它建适配器）。它**不是某一台机器的状态**：工坊对外的参数口径是项目级的，
// 每个检出都该用同一份 —— 所以落点选在入库的 `config/workshop-mode-contracts.json`，
// 而不是 `data/`（那是本机运行期目录，`.gitignore` 忽略、且被分发产物剥离）。
//
// 与 `data/` 那条线的分工（别把两者混起来）：
//   · `config/` = 项目配置，入库、随包、人人一致（本文件）；
//   · `data/`   = 本机私有输入：`llm-secret.key` / `workshop-api-settings.json`
//     （API 密钥）与 `runtime-secret.json`，**刻意**不入库、且不得随包分发。
// 契约里没有任何凭据（口清单 + 输出类别），所以它属于前者。
//
// 未存储的模式回落内置默认（builtInModeContract），升级零破坏。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";

import { MODE_CONTRACTS_REL_PATH } from "./mode-contract-file";
import { parseModeContracts, type ModeContract } from "./model-mode-contract";

export { MODE_CONTRACTS_REL_PATH };

/** 旧落点（`data/` 那条本机运行期目录）。只为「读过一次老配置」保留。 */
const LEGACY_REL_PATH = path.join("data", "workshop-mode-contracts.json");

/**
 * 读取模式契约注册表（只含改过的模式；坏数据 / 文件缺失按空处理）。
 *
 * `root` 默认 `process.cwd()`（Next server 与桌包侧都锚在应用根），用例传临时
 * 目录即可真读写而不碰仓库。
 *
 * 老落点兜底：契约曾存在 `data/workshop-mode-contracts.json`（本机、不入库），
 * 在那些机器上升级后**不会**静默丢掉既有配置 —— 新文件不在时才去读它，且只读不搬
 * （读路径不产生副作用；下次保存自然落到新位置）。新文件一旦存在就**只认**它，
 * 否则「老文件里更旧的副本」会在删改之后把内容复活。
 */
export async function loadModeContracts(
  root: string = process.cwd(),
): Promise<ModeContract[]> {
  const current = await readContractsFile(
    path.join(root, MODE_CONTRACTS_REL_PATH),
  );
  if (current !== null) return current;
  return (await readContractsFile(path.join(root, LEGACY_REL_PATH))) ?? [];
}

/** 保存整份模式契约注册表（归一化后覆盖 `config/workshop-mode-contracts.json`）。 */
export async function saveModeContracts(
  contracts: ModeContract[],
  root: string = process.cwd(),
): Promise<ModeContract[]> {
  const normalized = parseModeContracts(contracts);
  const file = path.join(root, MODE_CONTRACTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8",
    );
  } catch (err) {
    /* 失败必须说出来：「保存了但没落盘」是最坏的形态（用户以为配置生效、
     *  实际下一次读取回到旧值），而它唯一的痕迹就是这里。桌包场景下这条最可能
     *  被触发 —— 安装目录不可写。文案走 `errorText`（动作前缀 + 详情的唯一出口，
     *  规范 16 §16.2.4.45），并把**文件路径**带上：它是这条路唯一能定位的东西。 */
    throw new Error(errorText(err, `模式契约写入失败（${file}）`));
  }
  return normalized;
}

/** 读一份契约文件：文件不在返回 null（与「读出来是空数组」区分开）。
 *
 * 两种情况合起来按「没配过」处理：① 文件不在（没配过 / 平台差异）；
 * ② 内容不是合法 JSON 或形状不对（手改坏了）。契约是**可手改的项目配置**，
 * 坏文件不该把工坊整条链路打成 500 —— 它回落内置默认，界面照常可用。 */
async function readContractsFile(file: string): Promise<ModeContract[] | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    return parseModeContracts(JSON.parse(raw));
  } catch {
    return [];
  }
}
