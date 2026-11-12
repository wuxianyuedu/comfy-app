/**
 * 平台侧「红了就自己补上再验」的登记表 ⇄ `.cnb.yml` 双向同源（ISSUE #1981）。判的不是「哪几档该自动修」，而是「自动修名单只有一处出处」（口径与边界见 §13.5.19）。
 * ① 登记表每条 ⇒ 配置同名 stage 的 `script` 点名其入口且 `--autofix` / `--check` 逐字都在；② 带自动修旗标的 stage ⇒ 必须在登记表里。少任一半就退化成「看着在自动修、修了什么没人知道」（与 §13.5.18 的 `ifModify` 判据同源）。
 * 进固定清单（`scripts/fixed-structural-tests.mjs`）因触发面恰是 `.cnb.yml`：只改配置在静态 import 图里追不到用例，「只在受影响时跑」会随下次配置改动错过。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
/* ISSUE #3378 收尾：`生成态文档与源同步` 由 GA `master-gate.yml` 承接，自动修执行面
 * 从 CNB stage 换到 GA step（同款入口、同款旗标）。 */
const GA_MASTER_GATE = readFileSync(
  path.join(process.cwd(), ".github/workflows/master-gate.yml"),
  "utf8",
);

describe("平台侧自动修档（.cnb.yml --autofix ⇄ 登记表）", () => {
  it("真仓一致：登记表与两个执行面（stage + 聚合档条目）逐字同源", () => {
    const problems = checkAutofixDuties(CONFIG, ["--autofix"], HEAVY_GATES, GA_MASTER_GATE);
    expect(problems, `平台侧自动修登记与配置不一致：\n${problems.join("\n")}`).toEqual([]);
  });

  it("登记表为空是合法终态：真仓没有任何一格会自动修工作区", () => {
    /* #3586 摘掉最后一条「生成态文档与源同步」之后，平台侧再没有「源 → 入库产物」
     * 的重生成档（#2231 已让 `docs/api/` 出库、#2610 已把格式修回本地 D0）。所以
     * **空表是结论，不是清单被掏空**：`checkAutofixDuties` 的方向二（执行者带
     * `--autofix` ⇒ 必须在登记表里）此刻等价于一条禁令 —— 谁把自动修加回来谁红。
     * 把空表钉成当前形态，将来真要恢复某一档就必须连同这条用例一起改，而不是
     * 悄悄往数组里塞一项（「判据不是空转」的反向验证挪到本文件最后一条）。 */
    expect(
      AUTOFIX_DUTIES.length,
      "自动修登记表不为空 —— 新增一档必须同步改这条用例，并写清「凭什么可以自动修」",
    ).toBe(0);
    for (const duty of AUTOFIX_DUTIES) {
      expect(duty.stage.length, "没写 stage 名").toBeGreaterThan(0);
      expect(duty.entry, `${duty.stage} 没写入口脚本`).toMatch(/^scripts\/.+\.(?:cjs|mjs)$/);
      expect(duty.args.length, `${duty.stage} 的判定门是空的`).toBeGreaterThan(0);
      expect(duty.why.length, `${duty.stage} 没写清「凭什么可以自动修」`).toBeGreaterThan(80);
    }
    /* 正向核对：真仓的三份执行面（CNB stage / 聚合档条目 / GA step）里一行
     * `--autofix` 都不许有。少了这一半，「表空」也可能只是「忘了登记」。 */
    const executors = collectExecutors(CONFIG, HEAVY_GATES, GA_MASTER_GATE);
    const withAutofix = [...executors.entries()]
      .filter(([, line]) => line.includes("--autofix"))
      .map(([name]) => name);
    expect(withAutofix, `这些执行者带着 --autofix 却没登记：${withAutofix.join(", ")}`).toEqual([]);
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
    const executors = collectExecutors(CONFIG, HEAVY_GATES, GA_MASTER_GATE);
    for (const name of AUTOFIX_STAGE_NAMES) {
      const line = executors.get(name) ?? "";
      expect(line, `${name} 的 script 不认识（解析为空）`).not.toBe("");
      expect(line, `${name} 少了 --check：只写不判 = 恒绿`).toContain("--check");
      expect(line, `${name} 少了 --autofix`).toContain("--autofix");
    }
  });

  it("判据不是空转：空表下「绕过登记表」仍被点名，普通判据不误报", () => {
    /* 表空时方向一（表里每条 ⇒ 执行者还在）没有对象，方向二成了唯一承重的那一半。
     * 所以反向验证改判方向二的正/负控，而不是继续造「表里那条找不着」的样本
     * ——那份样本在空表下恒返回 []，留着它等于把判据空转当成绿。 */
    /* ① 正控：配置里绕过登记表直接挂 `--autofix` ⇒ 必须被点名。
     * 缩进按 `.gates: &gates` 那一层的真实形态写（2 空格 `- name:` + 4 空格
     * `script:`）—— 写成别的缩进会被解析器正确拒收，那条红说的是「解析不出」，
     * 与本格要判的「绕过了登记表」不是同一件事。 */
    expect(
      checkAutofixDuties(
        "gates: &gates\n  - name: 样本判据\n" +
          "    script: node scripts/check-file-structure.cjs --check --autofix\n",
      ),
    ).toContainEqual(expect.stringContaining("不在登记表里"));
    /* ② 负控：只带 `--check` 的普通判据不许被认成自动修档 —— 否则每加一条
     * `--check` 判据都会撞上这条禁令，判据会被人当误报摘掉。 */
    expect(
      checkAutofixDuties(
        "gates: &gates\n  - name: 样本判据\n" +
          "    script: node scripts/check-file-structure.cjs --check\n",
      ),
    ).toEqual([]);
    /* ③ 聚合档条目那一侧同款：执行面不止 `.cnb.yml` 的 stage，绕过登记表
     * 直接给聚合档条目挂自动修也要红（生成器在 `collectExecutors`）。 */
    expect(
      checkAutofixDuties(
        "",
        ["--autofix"],
        [{ name: "样本条目", argv: ["node", "scripts/check-file-structure.cjs", "--autofix"] }],
      ),
    ).toContainEqual(expect.stringContaining("不在登记表里"));
  });
});
