/**
 * 平台侧「红了就自己补上再验」的登记表 ⇄ `.cnb.yml` 双向同源（ISSUE #1981）。判的不是「哪几档该自动修」，而是「自动修名单只有一处出处」（口径与边界见 §13.5.19）。
 * ① 登记表每条 ⇒ 配置同名 stage 的 `script` 点名其入口且 `--autofix` / `--check` 逐字都在；② 带自动修旗标的 stage ⇒ 必须在登记表里。少任一半就退化成「看着在自动修、修了什么没人知道」（与 §13.5.18 的 `ifModify` 判据同源）。
 * 进固定清单（`scripts/fixed-structural-tests.mjs`）因触发面恰是 `.cnb.yml`：只改配置在静态 import 图里追不到用例，「只在受影响时跑」会随下次配置改动错过。
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
      expect(duty.entry, `${duty.stage} 没写入口脚本`).toMatch(/^scripts\/.+\.(?:cjs|mjs)$/);
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
