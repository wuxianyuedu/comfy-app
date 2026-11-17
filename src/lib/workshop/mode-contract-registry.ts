// ── 模式契约**注册表的三层**（成品配置 / 本机覆盖 / 生效值）────────────────
//
// 契约**是什么**在 `model-mode-contract.ts`（形状、口 id、解析、推导、成品配置
// 快照）；这一份只管**注册表怎么分层**：
//
//   · 成品配置（configured）—— 跟代码走的那份（项目默认 JSON）。每个检出 / 每个
//     桌包同一份；开发检出里它由服务端**现读磁盘**（写完即生效，不必重启）。
//   · 本机覆盖（override）—— 这台机器上额外改的那点东西，落在 `data/`，只存
//     「与成品配置真的不同」的那些模式（差集）。
//   · 生效值（effective）—— 逐模式把覆盖压过成品配置之后的那一份：界面读它、
//     工坊运行读它、「保存为项目默认」写它。
//
// 三个动作各自只有一处实现（别处不重抄）：
//   · `mergeModeContracts` —— 逐模式合并（覆盖里内容与成品配置相同的那条按
//     「没改过」处理，生效值回落成品配置本身）；
//   · `localOverrideDiff` —— 本机覆盖该写什么（与成品配置有差异的那些）；
//   · 比较键 `modeContractSignature` 在契约那一层（它是契约的属性，不是注册表
//     的属性）。

import { upperToken } from "~/lib/upper-token";

import {
  configuredModeContracts,
  derivedModeContract,
  modeContractSignature,
  type ModeContract,
} from "./model-mode-contract";

/** 生效注册表 = 成品配置**逐模式**压上本机覆盖。
 *
 *  逐模式、不是「覆盖整份压过」：本机覆盖存的是**差集**（只留真改过的模式），
 *  拿它整份替换注册表 = 其余二十个模式连成品配置都读不到，工坊运行时就回落
 *  推导 —— 那正是「编辑器看到 A、运行跑 B」的分叉（ISSUE #3634 的现场之一：
 *  机器上有过本机覆盖之后，其余模式的口清单在运行侧悄悄换成了推导值）。
 *
 *  覆盖里内容与成品配置相同的那条按「没改过」处理：生效值回落成品配置本身
 *  （两条本来就一样），「已改」徽标也就不点亮它。
 *
 *  覆盖里有、成品配置里没有的模式（老检出残留 / 手改）**不丢**，追加在后面 ——
 *  静默丢掉用户配过的东西比「多一条」坏得多。 */
export function mergeModeContracts(
  configured: ReadonlyArray<ModeContract>,
  override: ReadonlyArray<ModeContract>,
): Array<ModeContract> {
  const byMode = new Map(override.map((contract) => [upperToken(contract.mode), contract]));
  const merged = configured.map((base) => {
    const found = byMode.get(upperToken(base.mode));
    if (!found) {
      return base;
    }
    if (modeContractSignature(found) === modeContractSignature(base)) {
      return base;
    }
    /* 覆盖那条的模式码归一（大写）—— 注册表按大写匹配，进来一份小写会让
     * 「按模式查」的那一格查不到。 */
    return { ...found, mode: upperToken(found.mode) };
  });
  const extra = override
    .filter(
      (contract) => !configured.some((base) => upperToken(base.mode) === upperToken(contract.mode)),
    )
    .map((contract) => ({ ...contract, mode: upperToken(contract.mode) }));
  return [...merged, ...extra];
}

/** 「保存模式契约」（本机覆盖）该写进 `data/` 的内容：与**成品配置**有差异的
 *  那些契约。
 *
 *  基准是**注入**的（默认：编译进包的那份成品配置快照）—— 服务端那一侧传的是
 *  **现读**的项目默认基线（写完即生效的那份），否则「保存为项目默认」之后紧接
 *  的一次本机保存会拿旧基准算差集，把已经与基线相同的模式也留在覆盖里。
 *
 *  本机里存一条与成品配置相同的契约，读出来还是同一份内容，只会徒增「已改」的
 *  假象（ISSUE #3396 反馈 1 的现场：保存整份注册表后，二十多个模式全量亮「已改」）。 */
export function localOverrideDiff(
  contracts: ReadonlyArray<ModeContract>,
  base: ReadonlyArray<ModeContract> = configuredModeContracts(),
): Array<ModeContract> {
  const byMode = new Map(base.map((contract) => [upperToken(contract.mode), contract]));
  return contracts.filter((contract) => {
    const found = byMode.get(upperToken(contract.mode));
    const fallback = found ?? derivedModeContract(contract.mode);
    return modeContractSignature(contract) !== modeContractSignature(fallback);
  });
}
