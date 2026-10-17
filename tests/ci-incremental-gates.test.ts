/**
 * 平台侧门禁的**增量收窄**：`.cnb.yml` 的 `ifModify` ⇄ 登记表双向同源。
 *
 * ── 这条判据守的是什么（ISSUE #1981）─────────────────────────────────────
 *
 * 背景是用户的一句质疑：「CI 里的检查能否增量，而不是没有改动也重跑」。
 * 本地钩子早就有这一层（`scripts/gate-scan-read.cjs` 的
 * `skipUnlessStagedTouches()`：暂存改动一点都没落在扫描面里就跳过），
 * 而平台侧那条流水线不知道「扫描面」这回事 —— 改一行 README 也要把
 * 「函数长度」「跨文件重复块」「ComfyUI 端口口径」这些**只扫 `src/**`** 的判据
 * 重跑一遍。`.cnb.yml` 的 stage 支持 `ifModify: [glob…]`，语义与它逐字同义。
 *
 * ── 这条判据判的**不是**「哪几条该收窄」（那是收益判断，要实测），而是
 * **「收窄名单只有一处出处」**：
 *
 *   ① 登记表里每条 ⇒ 配置里同名 stage 必须带着那组逐字相同的 `ifModify`
 *      （写漏 / 写错一个 glob 都红）；
 *   ② 配置里带 `ifModify` 的 stage ⇒ 必须在登记表里（绕过登记表直接收窄也红）。
 *
 * 少了任一半都会退化成「**看着在收窄、其实收窄了什么没人知道**」：
 * 只有①时，有人可以直接在 YAML 里给一个全仓级判据（如 `文件结构硬规则`）挂上
 * `ifModify`，判据强度当场被削而没有任何信号；只有②时，登记表会慢慢变成一份
 * 与配置无关的文档。
 *
 * ── 为什么它进固定清单（`scripts/fixed-structural-tests.mjs`）──────────────
 *
 * 它守的是「**哪些 stage 被允许跳过**」这件事本身 —— 一次误收窄（给一条全仓级
 * 判据挂上窄 glob）不会让任何别的判据变红，只会让下一次真回归**静默漏过**。
 * 而触发它的改动面恰好是 `.cnb.yml`：只改它在静态 import 图里追不到任何用例，
 * 于是「只在受影响时才跑」等于让它随下一次配置改动过去。
 *
 * 口径与边界见规范 §13.5.18。
 */
import { describe, expect, it } from "vitest";

import {
  INCREMENTAL_GATES,
  INCREMENTAL_GATE_NAMES,
  checkIncrementalGates,
  parseStageIfModify,
  readCnbConfig,
} from "../scripts/ci-incremental-gates.mjs";

const CONFIG = readCnbConfig();

describe("平台侧门禁的增量收窄（.cnb.yml ifModify ⇄ 登记表）", () => {
  it("真仓一致：登记表与 .cnb.yml 逐字同源", () => {
    const problems = checkIncrementalGates(CONFIG);
    expect(
      problems,
      `平台侧增量登记与配置不一致：\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("登记表非空（清单被掏空时这条会红，而不是让上面那条恒绿）", () => {
    /* 反向验证：没有这一条，把 INCREMENTAL_GATES 清空会让上面那条变成恒真 ——
     * 「判据不是空转」的同一形态（见 tests/no-platform-ci-config.test.ts 的头注）。 */
    expect(INCREMENTAL_GATES.length).toBeGreaterThan(0);
    for (const gate of INCREMENTAL_GATES) {
      expect(gate.globs.length, `${gate.name} 的 globs 是空的`).toBeGreaterThan(
        0,
      );
      expect(gate.script, `${gate.name} 没写它守的是哪份脚本`).toMatch(
        /^scripts\/.+\.(cjs|mjs)$/,
      );
      expect(
        gate.why.length,
        `${gate.name} 没写「为什么这条收窄安全」`,
      ).toBeGreaterThan(20);
    }
  });

  it("解析出的 stage 数 == 配置里 `ifModify:` 出现次数（解析器不空转、也不误吞）", () => {
    /* 这一条抓的是**解析器失灵**：`.cnb.yml` 换了缩进 / 换了 `ifModify` 的写法
     * （单行标量 ↔ 列表）时，`parseStageIfModify` 可能静默漏掉几条，而上面那条
     * 会以「配置里没有它」的名义报红 —— 那是个**误导人的红**（人以为要补配置，
     * 其实要修解析器）。用「配置里 `ifModify:` 这个 token 出现了几次」做独立复算。 */
    const occurrences = (CONFIG.match(/^ {4}ifModify:/gm) ?? []).length;
    expect(
      parseStageIfModify(CONFIG).size,
      `配置里有 ${occurrences} 处 4 空格缩进的 \`ifModify:\`，解析出 ${parseStageIfModify(CONFIG).size} 个 stage`,
    ).toBe(occurrences);
  });

  it("收窄判据只收「扫描面封闭」的那一类：全仓级 stage 一条都不许带 ifModify", () => {
    /* 这一组名字是**刻意点名**的：它们判的是全库级不变量或本次流水线的前提，
     * 任何一处改动都可能破坏它们 —— 收窄成任何子集都是漏判。
     * 加这一条是因为上面两条只能保证「登记表 ⇄ 配置」一致，而**登记表自己**
     * 可能被误扩（有人把 `文件结构硬规则` 写进表里，再在配置里补上 ifModify，
     * 前两条会一起放行）。 */
    const MUST_ALWAYS_RUN = [
      "工具链自证",
      "Python 可用性",
      "环境前提",
      "Install dependencies",
      "分支守卫",
      "同步数据库表结构",
      "类型检查",
      "文件结构硬规则",
      "UI/逻辑分离",
      "lib Node-only 声明",
      "格式化提交分离",
      /* ⚠️ `生成态文档与源同步` 曾经在这一列、ISSUE #1981 起**不在了**：它的两侧输入面
       * 都能点清（`SCOPED_DOCS` 全在 `docs/**`，`FACTS` 的提取源是 `src/**` 与三份配置），
       * 而且它现在带 `--autofix`（红了就地重渲染再判一次，见 §13.5.19）——
       * 「改一行 README 也要为它付一次全量扫描」正是要收掉的那笔钱。
       * 剩下的「文档面」两条仍在这一列：`API 文档生成物与源同步` 的输入面是
       * typedoc 的入口 glob（`src/lib|server|trpc`，域不是「改了 docs」），
       * `文档引用与权威源一致` 判的是**全库**文档里的引用与权威源一致。 */
      "API 文档生成物与源同步",
      "文档引用与权威源一致",
      "core 骨架单一事实源",
      "零消费导出",
      "core 出口纪律与基类纯度",
      "生产构建",
      "浏览器安装",
      "E2E 关键流程",
    ];
    const gated = parseStageIfModify(CONFIG);
    const wronglyGated = MUST_ALWAYS_RUN.filter((n) => gated.has(n));
    expect(
      wronglyGated,
      `这些 stage 被判为「任何改动都要跑」，不许挂 ifModify：${wronglyGated.join(", ")}`,
    ).toEqual([]);
    // 反过来：登记表里也不许出现它们（两个方向都堵住）。
    const inRegistry = MUST_ALWAYS_RUN.filter((n) =>
      INCREMENTAL_GATE_NAMES.has(n),
    );
    expect(
      inRegistry,
      `登记表里混进了全仓级 stage：${inRegistry.join(", ")}`,
    ).toEqual([]);
  });

  it("每条被收窄的 stage 在 .cnb.yml 里都真实存在且能跑（不是登记了一条不存在的）", () => {
    /* `checkIncrementalGates` 只核对 `ifModify`，不核对「这条 stage 还在不在
     * `COMFYAPP_CI_GATES` 的顺序清单里」—— 有人把某条 stage 从 GATES 摘掉、
     * 又把 ifModify 留在原地时，上面几条会一起绿，而配置里多了一段死 YAML。 */
    /* 解析形态与 `tests/no-platform-ci-config.test.ts` 的 `registeredGateOrder` 同构 ——
     * 那里是它的**唯一权威**（本判据只借这份读数核对一行事实，不另立第二份清单定义）。
     * 写成显式两段而不是可选链连写：`?.[1].split()` 在 `noUncheckedIndexedAccess` 下
     * 会被判成「$1 可能是 undefined」，而它在正则命中时必然存在（tsc 抓不到这层语义）。 */
    const gateListBody =
      /^[ \t]*COMFYAPP_CI_GATES:[ \t]*>?-?[ \t]*\r?\n((?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
        CONFIG,
      )?.[1];
    const order =
      gateListBody === undefined
        ? []
        : gateListBody
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
    for (const gate of INCREMENTAL_GATES) {
      expect(
        order.includes(gate.name),
        `\`${gate.name}\` 带着 ifModify，却不在 COMFYAPP_CI_GATES 的顺序清单里（死配置）`,
      ).toBe(true);
    }
  });
});
