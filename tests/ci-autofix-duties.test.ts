/**
 * 平台侧「红了就自己补上再验」的登记表 ⇄ `.cnb.yml` 双向同源（ISSUE #1981）。
 *
 * ## 这条判据守的是什么
 *
 * 用户的诉求是「`pnpm doc:render` 别在本地跑，CI 检测到文档改动就自己跑一遍再提交」。
 * 其中「别让人本地跑」那一半的机器化形态是**自动修档**：判据红了就地重新生成一遍、
 * 再判一次。而这件事一旦铺开，最坏的失效形态是**没人知道哪几档会改工作区** ——
 * 某天某个 stage 忽然把一份源码改写了，而配置里看不出任何异常（`--autofix` 这类旗标
 * 只是一个词，删掉它也不会让别的判据变红）。
 *
 * 所以本文件判的**不是**「哪几档该自动修」（那是收益判断，要看「产物是不是纯确定的
 * 重新生成」与「红了有没有第二种成因」），而是 **「自动修名单只有一处出处」**：
 *
 *   ① 登记表里每条 ⇒ 配置里同名 stage 的 `script` 真的点名它的入口，且 `--autofix`
 *      与 `--check` 逐字都在（写漏一个 ⇒ 这一步要么不判、要么只写不判）；
 *   ② 配置里带自动修旗标的 stage ⇒ 必须在登记表里（绕过登记表直接给某一档挂上
 *      自动修，等于让它在没人审过的情况下改写工作区）。
 *
 * 少了任一半都会退化成「看着在自动修、修了什么没人知道」：只有①时，有人直接在 YAML
 * 里给一条全库级判据挂上 `--autofix`，判据强度当场被削而没有任何信号（与 §13.5.18
 * 那条 `ifModify` 的双向判据同源，两条守的是同一类失效）。
 *
 * ## 为什么它进固定清单（`scripts/fixed-structural-tests.mjs`）
 *
 * 触发面恰好是 `.cnb.yml`：只改配置在静态 import 图里追不到任何用例，于是「只在受影响
 * 时才跑」等于让它随下一次配置改动过去 —— 而它守的正是「下一次配置改动有没有偷偷
 * 让某一档改成自动修」。
 *
 * 口径与边界见规范 §13.5.19。
 */
import { describe, expect, it } from "vitest";

import {
  AUTOFIX_DUTIES,
  AUTOFIX_STAGE_NAMES,
  checkAutofixDuties,
  collectExecutors,
  parseStageScripts,
  readCnbConfig,
} from "../scripts/ci-autofix-duties.mjs";
import { HEAVY_GATES } from "../scripts/ci-heavy-gates.mjs";

const CONFIG = readCnbConfig(process.cwd());

describe("平台侧自动修档（.cnb.yml --autofix ⇄ 登记表）", () => {
  it("真仓一致：登记表与两个执行面（stage + 聚合档条目）逐字同源", () => {
    const problems = checkAutofixDuties(CONFIG, ["--autofix"], HEAVY_GATES);
    expect(problems, `平台侧自动修登记与配置不一致：\n${problems.join("\n")}`).toEqual([]);
  });

  it("登记表非空，且每条都写清了「凭什么可以自动修」", () => {
    /* 反向验证：没有这一条，把 AUTOFIX_DUTIES 清空会让上面那条变成恒真 ——
     * 「判据不是空转」的同一形态（见 tests/ci-incremental-gates.test.ts 的同款）。 */
    expect(AUTOFIX_DUTIES.length).toBeGreaterThan(0);
    for (const duty of AUTOFIX_DUTIES) {
      expect(duty.stage.length, "没写 stage 名").toBeGreaterThan(0);
      expect(duty.entry, `${duty.stage} 没写入口脚本`).toMatch(/^scripts\/.+\.(cjs|mjs)$/);
      expect(duty.args.length, `${duty.stage} 的判定门是空的`).toBeGreaterThan(0);
      /* `why` 不许是「顺手加的」：两条前提（纯确定的重生成 / 红了只有一种成因）
       * 各要有一句，所以下限放在「足够长到写清这两件事」的量级上。 */
      expect(duty.why.length, `${duty.stage} 没写清「凭什么可以自动修」`).toBeGreaterThan(80);
    }
  });

  it("解析出的 stage 数 == 配置里单行 `script:` 的条数（解析器不空转、也不误吞）", () => {
    /* 这一条抓的是**解析器失灵**：`.cnb.yml` 换了缩进、或某一步改成块标量（`script: |`）
     * 时，`parseStageScripts` 会静默漏掉它 —— 而上面那条会以「配置里没有它」的名义报红，
     * 那是个误导人的红（人以为要补配置，其实要修解析器）。 */
    const occurrences = (CONFIG.match(/^ {4}script: \S/gm) ?? []).length;
    expect(
      parseStageScripts(CONFIG).size,
      `配置里有 ${occurrences} 处单行 \`script:\`，解析出 ${parseStageScripts(CONFIG).size} 个 stage`,
    ).toBe(occurrences);
  });

  it("自动修名单是**封闭**的：每一档都点名了 `--check` 与 `--autofix` 两个旗标", () => {
    /* 只有 `--autofix` 而没有 `--check` 是**最坏的形态**：脚本会走写入模式（它不判任何
     * 东西、恒退 0），于是这一步永远绿 —— 判据在配置里、结论恒放行。 */
    const executors = collectExecutors(CONFIG, HEAVY_GATES);
    for (const name of AUTOFIX_STAGE_NAMES) {
      const line = executors.get(name) ?? "";
      expect(line, `${name} 的 script 不认识（解析为空）`).not.toBe("");
      expect(line, `${name} 少了 --check：只写不判 = 恒绿`).toContain("--check");
      expect(line, `${name} 少了 --autofix`).toContain("--autofix");
    }
  });

  it("判据不是空转：坏配置必须被点名（三个方向各一条）", () => {
    /* ① 登记了、配置里没有这个 stage。 */
    expect(
      checkAutofixDuties("gates: &gates\n  - name: 别的\n    script: node x.cjs\n"),
    ).toContainEqual(expect.stringContaining("配置与聚合档里都没有这个名字"));
    /* ② 配置里那一档点名了入口却没带 `--autofix`。
     * 缩进按 `.gates: &gates` 那一层的真实形态写（stage 项在 `gates:` 名下，
     * 所以是 2 空格 `- name:` + 4 空格 `script:`）—— 写成别的缩进会被解析器正确地
     * 拒收，那条红说的是「解析不出」，与本格要判的「旗标漏了」不是同一件事。 */
    const missingFlag = checkAutofixDuties(
      "gates: &gates\n  - name: 生成态文档与源同步\n" +
        "    script: node scripts/render-doc-placeholders.cjs --check\n",
    );
    expect(missingFlag).toContainEqual(expect.stringContaining("--autofix"));
    /* ③ 绕过登记表直接给某一档挂上自动修。 */
    const bypass = checkAutofixDuties(
      "gates: &gates\n  - name: 文件结构硬规则\n" +
        "    script: node scripts/check-file-structure.cjs --autofix\n",
    );
    expect(bypass).toContainEqual(expect.stringContaining("不在登记表里"));
  });
});
