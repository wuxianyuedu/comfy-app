/**
 * 「棘轮拒涨那一刻说的话，必须给出上涨态里可执行的下一步」的**唯一实现**。原先只住在 `tests/ratchet-update-guards.test.ts` 第 ⑥ 步、只覆盖 `RATCHETS` 表；归进 `COVERED_LOCALLY` 的四份本地用例只钉退出码 + 一个短语，没人判「出路是不是死路」（§11.2.1 假保险的登记形态）。
 * `check-tsc-diagnostic-executors.cjs` 是唯一落地的现场：红话写「再跑 `--update`（收紧到 N）」，而同一个 `--update` 对上涨正是非零拒绝 —— 照它跑只会再吃一次红，红话与机制相反，比没有红话更糟。
 * 四种自洽写法都算通过：先改再 `--update`（写明顺序）、明说不要用 `--update`、改成人的动作（手工登记 / 逐条写理由）、例外流程另给显式旗标（`check-bundle-budget.cjs`：贴 before/after + 由造成它的 PR 认账后带 `--allow-increase`；刻意**不认 `--update` 本身**，否则原始现场又被放过）。
 */
import { expect } from "vitest";

/**
 * 上涨态里「可执行的下一步」的四种形状（判的是那句话，不是脚本里随便哪行注释）。
 * 第二个分支认**明说不要用**这一族，措辞按实到的三种收：`不要用` / `不许用` / `不给`（`check-tsc-diagnostic-executors.cjs`
 * 写的是「这一步**不给 `--update`**」）。刻意按形状而非整句字面量：一句红话换个说法就判红，那种判据下次会被当噪音绕过去。
 */
export const ACTIONABLE_REFUSAL =
  /先[\s\S]{0,240}?(再|之后)[\s\S]{0,60}--update|不(要用|许用|给)\s*`?--update`?|`?--update`?\s*(是|只用于|不能拿来|拒绝)|(手工|逐条)[\s\S]{0,60}(登记|改|写)|带\s*`?--(?!update)[a-z][a-z-]*`?/;

/**
 * 断一次「`--update` 拒涨」的输出。
 * 调用点必须传**拒涨那一刻**捕获的输出（退出码已判非零的那一次）；不要传收紧成功那一次 ——
 * 那时这句话本来就不该出现，判它等于判空气。
 */
export function expectActionableRefusal(output: string, who: string): void {
  expect(
    output,
    `${who}：--update 拒涨了，但红话没给出上涨态里可执行的下一步` +
      `（四种自洽写法见本文件头：先改再 --update / 明说不要用 --update / 改成人的动作 /` +
      ` 例外流程另给一个显式认账旗标）。\n${output}`,
  ).toMatch(ACTIONABLE_REFUSAL);
}
