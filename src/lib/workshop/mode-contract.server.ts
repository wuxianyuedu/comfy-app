// ── 工坊模式契约：服务端存储（规范 §17.2 服务端层）───────────────────────
// 每种模式的统一输入 / 输出是工坊全局口径（本地工作流按它配落点、远端模型按它
// 建适配器）。读这一侧要合**两层**来源，顺序与「谁压谁」是这一层的全部内容：
//
//   ① 成品配置（`model-mode-contract.ts` 的 `configuredModeContracts`）—— 跟代码
//      走的那份基线（#3603 起即入库的 `mode-contract-defaults.json`，全部生成类
//      模式都显式在文件里）。**开发检出里现读磁盘**（`readConfiguredModeContracts`），
//      写完即生效、不必重启；桌包载荷里没有这份源码 ⇒ 回落编译进包的那份快照。
//   ② 本机覆盖（`data/workshop-mode-contracts.json`）—— 编辑器保存出来的那份，
//      按 `process.cwd()` 锚在应用根。它在而不空才生效，且**逐模式**压过 ①。
//
// 为什么是「逐模式压过」而不是「整份压过」：本机覆盖存的是**差集**（只留真改过
// 的模式，#3396），拿它整份替换注册表 = 其余模式连成品配置都读不到、回落推导 ——
// 于是编辑器看到的是项目默认、工坊跑的是推导值（#3634 的现场之一）。
//
// 与 `data/` 那条私有目录的关系：本机覆盖落在 `data/` 里正合适 —— 它**就是**
// 「这台机器上额外改的那点东西」，不是随包分发的项目配置。同目录的
// `llm-secret.key`（LLM 主密钥）/ `runtime-secret.json` 是另一类：那是必须留在
// 本机的凭据，被 `standalone-private-inputs.mjs` 按形状剥出分发产物；而本机覆盖
// 不含任何凭据，随不随包都不改变行为（产物里没有编辑入口，读到的也就是成品配置）。

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { errorText } from "~/lib/error-message";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";
import { upperToken } from "~/lib/upper-token";

import {
  MODE_CONTRACTS_REL_PATH,
  MODE_CONTRACT_DEFAULTS_REL_PATH,
} from "./mode-contract-write-path";
import { localOverrideDiff, mergeModeContracts } from "./mode-contract-registry";
import {
  ALL_CONTRACT_MODES,
  configuredModeContracts,
  parseModeContracts,
  requiredInputsFor,
  type ModeContract,
} from "./model-mode-contract";

/** 旧落点（契约曾落在**入库的** `config/` 里，ISSUE #1901 那一版）。 */
const LEGACY_CONFIG_REL_PATH = path.join("config", "workshop-mode-contracts.json");

/** 成品配置（项目默认基线）：**现读**磁盘上那份，编译进包的那份只当兜底。
 *
 *  为什么现读（#3634）：项目默认是入库的 `src/lib/workshop/mode-contract-defaults.json`，
 *  「保存为项目默认」写的就是它。此前读取侧只认**编译进包的那份快照**（静态
 *  import），于是写完那份文件必须重启进程才读到 —— 业主口径：「保存到项目默认为什么
 *  还要重启才能生效」。现读之后写完即生效；桌包里没有这份源码（`src/` 不随包
 *  分发），读不到就回落编译进包的那份 —— 随构建走的仍是同一份基线。
 *
 *  读不出来 / 不是数组 / 解析后一条都不剩 ⇒ 一律回落编译进包的那份：坏文件不该
 *  把整条链路打成「没有默认」。 */
export async function readConfiguredModeContracts(
  root: string = process.cwd(),
): Promise<Array<ModeContract>> {
  const file = path.join(/*turbopackIgnore: true*/ root, MODE_CONTRACT_DEFAULTS_REL_PATH);
  const raw = await readJsonArrayFile(file);
  if (raw === null) {
    return configuredModeContracts();
  }
  const explicit = parseModeContracts(raw);
  if (explicit.length === 0) {
    return configuredModeContracts();
  }
  /* 显式条目原样直读，文件里缺的那个模式回落推导兜底（手改误删时它照常出现）。 */
  return configuredModeContracts(ALL_CONTRACT_MODES, explicit);
}

/** 注册表的三层一次读完：成品配置 / 本机覆盖 / 生效注册表。
 *
 *  生效注册表 = 成品配置逐模式压上本机覆盖（`mergeModeContracts`）。这是界面、
 *  工坊运行与「保存为项目默认」共用的那一份 —— 三处各读各的就会出现「编辑器看到
 *  A、运行跑 B」。 */
export async function loadModeContractLayers(root: string = process.cwd()): Promise<{
  configured: Array<ModeContract>;
  contracts: Array<ModeContract>;
  override: Array<ModeContract>;
}> {
  const configured = await readConfiguredModeContracts(root);
  const override = await readOverrideLayers(root);
  return { configured, override, contracts: mergeModeContracts(configured, override) };
}

/** 生效的契约注册表（成品配置 + 本机覆盖，逐模式合并）。
 *
 *  老检出兜底：`config/` 那一版（ISSUE #1901）在那些机器上留下过一份手改的配置，
 *  升到本版后**不该静默丢掉**。所以覆盖不在时按「新落点 → 老落点」依次找一次，
 *  两份都只读不搬（读路径不产生副作用，迁不迁由人决定）。 */
export async function loadModeContracts(
  root: string = process.cwd(),
): Promise<Array<ModeContract>> {
  const { contracts } = await loadModeContractLayers(root);
  return contracts;
}

/** 保存整份本机覆盖（归一化 + **差集化**后覆盖 `data/workshop-mode-contracts.json`）。
 *
 *  差集化（ISSUE #3396 反馈 1）：与成品配置相同的模式**不落盘** —— 覆盖文件里
 *  只留「这台机器上真的改过的模式」。此前保存整份注册表，用户只改了一个模式、
 *  其余二十多个原样入库，读取侧「覆盖里有 = 已改」的判据就把它们全点亮了。
 *  「改回成品配置」由此免费成立：把草稿改回默认再保存 = 与成品配置相同 =
 *  从覆盖里消失（「还原默认」按钮是同一件事的显式出口）。传空数组 = 清空覆盖
 *  （全部回到默认）。
 *
 *  差集的基准是**现读**的成品配置（`readConfiguredModeContracts`）—— 「保存为
 *  项目默认」刚改过基线时，拿旧基准算差集会把已经与基线相同的模式留在覆盖里。
 *
 *  返回**落盘的**清单（差集，归一化后）—— 调用方（hook → refetch）拿它刷新
 *  界面，「已改」徽标随之只点亮真改过的模式。 */
export async function saveModeContracts(
  contracts: Array<ModeContract>,
  root: string = process.cwd(),
): Promise<Array<ModeContract>> {
  const configured = await readConfiguredModeContracts(root);
  const normalized = localOverrideDiff(parseModeContracts(contracts), configured);
  const file = path.join(/*turbopackIgnore: true*/ root, MODE_CONTRACTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch (error) {
    /* 失败必须说出来：「保存了但没落盘」是最坏的形态（用户以为配置生效、
     * 实际下一次读取回到旧值），而它唯一的痕迹就是这里。文案走 `errorText`
     * （动作前缀 + 详情的唯一出口，规范 16 §16.2.4.45），并把**文件路径**带上：
     * 它是这条路唯一能定位的东西。 */
    throw new Error(errorText(error, `模式契约写入失败（${file}）`), {
      cause: error,
    });
  }
  return normalized;
}

/** 还原一个模式到默认：把它从本机覆盖里移除（生效值回落成品配置）。
 *
 *  覆盖文件**不在时不动**（本来就没有「这台机器的改动」，还原无事可做 ——
 *  读路径不产生副作用的同一条纪律，别让一次「还原」把空覆盖钉进本机）；
 *  移除后整份为空就把文件写成 `[]`（覆盖为空 = 全部回落默认，与保存侧同一
 *  形状）。返回该模式**还原后的生效契约**（成品配置那条），界面直接用它刷新
 *  草稿。 */
export async function resetModeContractOverride(
  mode: string,
  root: string = process.cwd(),
): Promise<{ contracts: Array<ModeContract>; effective: ModeContract | null }> {
  const file = path.join(/*turbopackIgnore: true*/ root, MODE_CONTRACTS_REL_PATH);
  const existing = await readOverrideFile(file);
  if (existing.length === 0) {
    return { contracts: [], effective: null };
  }
  const code = upperToken(mode);
  /* 保留的部分也过一遍差集：把旧版「整份注册表落盘」留下的存量膨胀
   * （与成品配置相同的条目）顺手清洗掉 —— 还原一次，文件就归位一次。 */
  const configured = await readConfiguredModeContracts(root);
  const contracts = localOverrideDiff(
    existing.filter((c) => upperToken(c.mode) !== code),
    configured,
  );
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(contracts, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(errorText(error, `模式契约还原失败（${file}）`), { cause: error });
  }
  const effective = configured.find((c) => upperToken(c.mode) === code) ?? null;
  return { contracts, effective };
}

/** 读本机覆盖（新落点 → 老落点，各一次；只读不搬）。
 *
 *  老检出那份也在时它兜底（老配置不该随升级静默丢掉），但**不**被写回新落点 ——
 *  读路径不产生副作用，迁不迁由人决定。 */
async function readOverrideLayers(root: string): Promise<Array<ModeContract>> {
  for (const rel of [MODE_CONTRACTS_REL_PATH, LEGACY_CONFIG_REL_PATH]) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    const parsed = await readOverrideFile(path.join(/*turbopackIgnore: true*/ root, rel));
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

/** 读一份覆盖文件：不在 / 读不出来 / 不是合法 JSON / 不是数组 / 解析后为空
 *  一律按「没有覆盖」处理（空数组）。
 *
 *  覆盖是**可手改的本机文件**，坏文件不该把工坊整条链路打成 500 —— 它回落成品
 *  配置，界面照常可用。 */
async function readOverrideFile(file: string): Promise<Array<ModeContract>> {
  const raw = await readJsonArrayFile(file);
  if (raw === null) {
    return [];
  }
  return parseModeContracts(raw);
}

/** 读一份 JSON 数组文件：不在 / 读不出来 / 不是合法 JSON / 不是数组 ⇒ null。 */
async function readJsonArrayFile(file: string): Promise<unknown[] | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 把「当前编辑的契约注册表」**全量**写进入库的项目默认
 *  （`src/lib/workshop/mode-contract-defaults.json`，跟代码走）。
 *
 *  #3603 起这份 JSON 是**完整基线**（全部生成类模式的口清单 / 输出 / 必备口
 *  都显式在文件里），不再是「与推导的差集」—— 差集 + 推导的双出处形态在
 *  「大部分模式都被显式配置过」之后只剩歧义（业主原话：修改多了，大部分
 *  也都会在这个 json 中配置的）。写全量 = 编辑器里的现状逐模式落盘，
 *  `required` 一并固化（基线自描述，不留「缺省回落」这一层）。
 *
 *  写的是**整份**（成品配置 + 本次编辑合并后的结果）：只写「编辑器发来的那几条」
 *  会把其余模式从基线里抹掉（#3634 的现场：文件里只剩一项，其他模式的内容
 *  全部消失）。与成品配置合并之后，这份文件永远是**完整基线**。
 *
 *  只有开发检出可以调：正式包没有源码可写，这格调用本身就是错用 —— 大声失败
 *  而不是假装成功。写完之后读取侧现读磁盘 ⇒ **不必重启进程**即生效。 */
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
  const configured = await readConfiguredModeContracts(root);
  /* 全量落盘 + required 固化：读侧拿到的每一条都自描述。 */
  const full = mergeModeContracts(configured, parseModeContracts(contracts)).map((c) => ({
    ...c,
    required: requiredInputsFor(c),
  }));
  const file = path.join(/*turbopackIgnore: true*/ root, MODE_CONTRACT_DEFAULTS_REL_PATH);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(errorText(error, `项目默认写入失败（${file}）`), { cause: error });
  }
  return { contracts: full, file };
}
