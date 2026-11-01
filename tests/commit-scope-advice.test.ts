/**
 * 「把大改动拆小」这条建议的判据。
 *
 * 为什么单独成一份：它判的是**另一件事**。`hook-affected-launch.test.ts` 守的是
 * 「启动那一步」的契约（分块不丢用例、负载自适应、命令行长预算），而这里守的是
 * **改动面的代价信息** —— 两者共用的只有那个入口文件。拆开也是为了不让任何一份
 * 长到要靠长度棘轮来管（同 §12.6 对「登记表 vs 编排」的分档口径）。
 *
 * ## 这条判据补的是什么洞
 *
 * 规范 §13.5.8.1 末尾那句「真正能让每次提交更快的是**把大改动拆小**」此前
 * **没有任何执行者**：提交的人拿不到「这次多大、哪一刀最值、拆完能省多少」。
 * 没有这三件，那句建议就只是散文。本文件的用例逐条钉住这三件事都被交付了，
 * 且这份建议**永远不许变成隐性阻断**（大改动有时不可分）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/* 这一格的两半（归因 + 话术）住在 `affected-launch-scope-advice.mjs` —— 从启动器那一层
 * 搬出去是因为它贴住了 900 行硬闸（§12.6 R5），判据一个字没改。用例跟着走：**读者面是
 * 函数自己**，不是它碰巧常住的那个文件。 */
import { scopeAdvice } from "../scripts/affected-launch-scope-advice.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const LAUNCHER_PATH = path.join(ROOT, "scripts", "run-affected-tests.mjs");
const ADVICE_PATH = path.join(ROOT, "scripts", "affected-launch-scope-advice.mjs");

describe("受影响用例的启动器 —— 「大改动拆小」这条建议的执行者", () => {
  /* 两处都要读：建议的**话术**在 advice 那份里，而「该不该印」那条判定留在启动器的
   * 调用点上（它读的是已经拿到的清单份数）—— 判据说的事横跨这两份，读一份就判不全。 */
  const src = readFileSync(LAUNCHER_PATH, "utf8");
  const adviceSrc = readFileSync(ADVICE_PATH, "utf8");

  it("面大时逐条点名「哪个改动文件把面撑大了」，并给出最大的一刀", () => {
    const text = scopeAdvice({
      total: 211,
      fixed: 77,
      affected: 134,
      elapsedMs: 63_100,
      top: [
        { file: "src/lib/core/repository.ts", affected: 134 },
        { file: "src/lib/hub.ts", affected: 41 },
      ],
    });
    expect(text).toContain("本次 211 份用例（固定 77 + 受影响 134）");
    expect(text).toContain("63.1s");
    // 逐条点名：只给一个总数，做不到「该从哪一刀切」。
    expect(text).toContain("src/lib/core/repository.ts → 受影响 134 份");
    expect(text).toContain("（最大的一刀）");
    expect(text).toContain("src/lib/hub.ts → 受影响 41 份");
    // 出路必须在（同 §11.23「声明 ⇄ 读者」：写一行没有出路的建议等于没写）。
    expect(text).toContain("COMFY_PRECOMMIT_MAX_WORKERS=1");
    expect(text).toContain("§13.5.8");
  });

  it("「剩下约 N 份」必须自认是**估算** —— 归因不可加，说成精确值就是假账", () => {
    /* 归因给的是「单独改它一个会跑多少份」，同一份测试常被多个改动文件共同拉到，
     * 所以 `总受影响 - 最大那个` 只会**偏大**。这条钉住那句话的形状：
     * 一旦有人把「**估算**」删掉、把它读成精确值，这条建议就开始给一个对不上的数
     * ——与 §13.5.8.2 那句「不伪造绿」是同一族。 */
    const text = scopeAdvice({
      total: 304,
      fixed: 77,
      affected: 227,
      elapsedMs: 90_100,
      top: [{ file: "src/lib/endpoints.ts", affected: 173 }],
    });
    const restLine = text.split("\n").find((l) => l.includes("剩下约"));
    expect(restLine, "有最大的一刀时就该给出「拆开之后剩多少」").toBeTruthy();
    expect(restLine).toContain("估算");
    // 数也要对：227 - 173 = 54（看得出它是怎么来的）
    expect(restLine).toContain("剩下约 54 份");
  });

  it("只有一刀时**不给**「剩下多少」——减完是 0，那句话没有信息", () => {
    const text = scopeAdvice({
      total: 142,
      fixed: 77,
      affected: 65,
      elapsedMs: 57_700,
      top: [{ file: "src/components/ui/tooltip.tsx", affected: 65 }],
    });
    expect(text).toContain("最大的一刀");
    expect(text).not.toContain("剩下约 0 份");
  });

  it("拿不到归因（空 top）也要给出读数与出路，不许整段消失", () => {
    // 归因那一步是「尽力而为」（`collectAttribute` 失败打空数组）—— 它一空就
    // 整段建议不印的话，这条链就退化成「一条没有产物的建议」。
    const text = scopeAdvice({
      total: 190,
      fixed: 77,
      affected: 113,
      elapsedMs: 58_000,
      top: [],
    });
    expect(text).toContain("本次 190 份用例（固定 77 + 受影响 113）");
    expect(text).toContain("本行不阻断提交");
    expect(text).toContain("COMFY_PRECOMMIT_MAX_WORKERS=1");
  });

  it("面**小**时一次都不该出现这条建议（否则它变成每次提交都刷的噪声）", () => {
    /* 拿 `scopeAdvice` 自己判：它是个纯函数，而「该不该印」由调用点的
     * `wantAdvice` 决定。这里两个方向都钉：① 阈值是个**实测划出来的分界**
     * （见 `SCOPE_ADVICE_MIN` 的文档），不是随手写的数；② 判定与调用点
     * 都读的是**已经拿到的清单份数**，不额外读 git。 */
    expect(adviceSrc).toMatch(/const SCOPE_ADVICE_MIN = \d+;/);
    expect(src).toMatch(/const wantAdvice = affectedCount >= SCOPE_ADVICE_MIN;/);
    // 小面上整段建议不该被拼出来（拼了却没印也是一种「写了没读者」）
    const small = scopeAdvice({
      total: 87,
      fixed: 77,
      affected: 10,
      top: [],
    });
    // 纯函数本身不判「该不该印」——它只回答「印什么」；所以这条只钉调用点的门
    expect(small).toContain("本次 87 份用例");
    expect(src).toContain("if (wantAdvice) {");
  });

  it("这段建议**只读清单份数、不额外读 git**（它挂在每次提交的关键路径上）", () => {
    /* 面小的时候连归因都不去算（`wantAdvice` 是用**已经拿到**的清单算出来的）。
     * 这条判的是「判断发生在 collectAttribute 之前」——顺序反了的话每次提交都要
     * 多付一次约 220ms 的图构建，而省下来的只是一句面小时不会印的话。
     * 退出码看不出这个差别（两边都是 0），所以只能钉在源码顺序上。 */
    const guard = src.indexOf("const wantAdvice =");
    // 锚点要取**调用点**（`top: collectAttribute(),`），不是函数定义
    const attr = src.indexOf("top: collectAttribute(),");
    expect(guard, "解不出 wantAdvice 的判定").toBeGreaterThan(-1);
    expect(attr, "解不出 collectAttribute 的调用点").toBeGreaterThan(-1);
    expect(guard, "判定必须在归因之前 —— 否则小面上白付一次图构建").toBeLessThan(attr);
    // 判定读的是**已经拿到**的清单（`affectedCount` 由上一段解析出的清单算出来），
    // 不是新起一次 git；那份清单的变量名随改动面拆过一次（#2905），所以只钉
    // 「从某个已有数组的 filter 结果来」这个形态。
    expect(src).toContain("const wantAdvice = affectedCount >= SCOPE_ADVICE_MIN;");
    expect(
      src,
      "affectedCount 必须从已经拿到的清单算出来 —— 另起一次 git 就是白付",
    ).toMatch(/const affectedCount = \w+\.filter\(/);
  });

  it("它**不改变退出码**（代价不是结论）—— 打印点自己不许 return", () => {
    /* 这条是本档最容易做坏的一格：把「这次的面很大」顺手写成非零退出码，
     * 大改动就从此提交不了，而大改动有时**不可分**（一次接口重命名天然横跨几十个文件）。
     *
     * 按源码结构判：`if (wantAdvice) { … }` 那一整段里不许出现任何 `return`
     * （包括 `return 0` —— 那会跳过后面所有步骤）。 */
    const start = src.indexOf("if (wantAdvice) {");
    expect(start, "解不出 wantAdvice 的打印点").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n  }", start));
    expect(body, "建议那一段里出现了 return —— 它就不再是纯信息了").not.toMatch(
      /\breturn\b/,
    );
    expect(body).toContain("scopeAdvice({");
  });

  it("建议在**起 vitest 之前**打 —— 真红的时候更需要看到这个数", () => {
    /* 本轮实测踩到的坑：第一版把建议放在收尾，结果一条真断言红（探针触发了
     * `check-dead-exports`）就把整段截断，一次都没印出来。而「这次的代价多大」
     * 恰恰是在提交被拦下时最该被看见的东西 —— 它决定「是拆一笔重来，还是就地修」。
     *
     * 判法：建议的调用点必须**早于**第一处 `runChunk(` 的调用。 */
    const advice = src.indexOf("scopeAdvice({");
    // 锚点取**增量档**那一处（`await runChunk(<清单>, …)`）—— `--full` 档里也有一处
    // `runChunk([])`，用「第一处」会把锚点落到那个档上，判据就守错了对象。
    // 实参名随改动面拆过一次（#2905），所以按「await runChunk( 且实参不是空数组」取。
    const firstRun = src.search(/await runChunk\((?!\[\])/);
    expect(advice).toBeGreaterThan(-1);
    expect(firstRun, "解不出增量档 runChunk 的调用点").toBeGreaterThan(-1);
    expect(advice, "建议被放到了跑完之后 —— 真红会把它截断").toBeLessThan(firstRun);
  });
});
