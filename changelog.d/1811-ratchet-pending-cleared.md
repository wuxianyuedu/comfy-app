## Changed

- **棘轮 `--update` 拒涨的横切判据补满：`PENDING` 从 2 格收到 0（ISSUE #1811，接
  #1815 / #1818 / #1820 / #1823 之后）**。`tests/ratchet-update-guards.test.ts`
  那两张表此前留着两格「有拒涨分支、但没有任何行为用例钉过」的欠账 ——
  本轮把两格的**卡点**拆开看，都是可以就地消掉的前提，不是这条判据的固有属性：

  - `.file-size-baseline.json`（R5，`check-file-structure.cjs --strict` 的那一半）
    卡在「沙箱里放一份 950 行文件会连带命中同脚本的 R1–R12 其它规则，五步里的第 ② 步
    （基线 = 现状时必须绿）先配不出来」。连带命中是真的（缺 `src/proxy.ts` 时 R11
    当场红），但那是**可配的输入**而不是判据的属性 —— 夹具带上 `src/proxy.ts`
    （R11 要的存在性证据）之后 R1–R12 全绿，第 ② 步成立，于是它进了 `RATCHETS`。
    判定档是 `--strict`（默认档对超限文件只打一行「仅提醒」，用默认档走第 ②/③ 步会得到
    「加第二条违规仍然绿」—— 那判的是「我没把判定档打开」）。
  - `.ui-primitives-baseline.json` 卡在「拒涨按 rule id 比较，要先把 rule 集合钉住」。
    实测：`HARD_GATE_RULES` 已覆盖全部 85 条、`ratchetOnly()` 恒返回空 ——
    **棘轮那条车道上一个成员都没有**，拒涨在此**无对象可判**。它不该按「还没配用例」
    记账，而该按「判据整条升硬闸、棘轮车道空置」记账 → 新增一张
    `RETIRED_RATCHETS` 表收它，与 `NOT_A_RATCHET` 分开（那里是「加条目本就是正常用法」，
    这里是「棘轮形态本身被淘汰」，两条路都不该走五步判据，理由却完全不同）。

  上限随之从 2 收到 **0**：留两格等于给下一条棘轮预支一张免配票，而那张票的代价恰恰是
  那条拒涨分支**没人钉过**（台账 E5 立案的正是这一格）。

## Fixed

- **分发产物缺 5 份编排器内部分件（PR #1823 的漏改，真·生产缺陷）**：
  `standalone-private-inputs.mjs` 的 `RUNTIME_SCRIPTS` 与
  `check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS` **两处都漏登记**了
  `launcher-core/{downstream,preflight,shell-ops,misc-ops,port-reap}.mjs`
  （硬规则 17 写着「新增一项必须同改两处」）。后果不是「测试红」而是：
  桌包脱离仓库后重新编排一次，ESM 在加载期解析整张图 ⇒ `ERR_MODULE_NOT_FOUND`
  ⇒ 用户只看到「双击没反应」，而本地开发（源码树齐全）一切照旧 ——
  最难查的那一类。`tests/dist-artifact-hygiene.test.ts` 的「清单覆盖编排器的相对
  import 闭包」当场点名，本次同批补进两张表。

- **`gate-hint-targets-exist.test.ts` 的覆盖面静默缩水**：它扫的是
  `scripts/check-*.cjs` 这一层，而 #1823 把**常量与清单表**搬进了
  `ui-primitives-rules-*.cjs` / `file-structure-rules.cjs` /
  `theme-color-exemptions.cjs` —— 「路径字面量」这一面恰恰住在数据模块里。
  实测路径字面量 **111 条 → 40 条**，掉的那 71 条**没有红**（少扫自然不报），
  于是覆盖面缩掉六成半而账面全绿。修法：`gateScripts()` 改成按
  `require("./x.cjs")` **递归展开闭包**（扫描面 26 → 66 份），清单不抄第二份 ——
  下次再拆一遍不会又忘一处。

- **11 份门禁自测因 #1823 的拆分而失效，同批修净**：它们读 `dev-launcher.mjs` /
  `check-file-structure.cjs` / `base-check.mjs` 再 `indexOf` + `slice` 断言，
  实现一搬走 `indexOf` 落空给 -1、`slice` 拿到空串 —— `toContain` 会红，而
  **`not.toContain` / `not.toMatch` 对着空串恒真**，于是它们从「钉住契约」变成
  「永远绿」。逐处改成链路源码、闭包展开或调用点断言。

## Added

- **`tests/helpers/launcher-source.ts`** —— 「启动编排链路的源码」的唯一出口
  （§12.18 复用优先，没有抄第八遍）：`launcherChainSource()` 从
  `dev-launcher.mjs` 出发、按顶层静态 import **递归**收全 `scripts/**` 再拼。
  三条口径：只拼只读（实现位置不是契约）；清单**现算不抄第二份**（下次再拆不必回来改）；
  递归是必须的（`shell-ops.mjs` 自己还 import `splash-assets.mjs`，只走一层就漏）。
- **`RETIRED_RATCHETS` 的每一条理由都要可核，不是便签**：那一条说的是
  「棘轮车道已无成员」，所以由判据自己回答 —— 在干净沙箱里跑一次 `--update`、
  读回它落盘的那份基线，断言 `rules` 是空对象（棘轮那一支只登记非硬闸规则）。
  核的方式**刻意不抄一份 `HARD_GATE_RULES`**：在用例里重列一遍规则清单会随每次升闸漂。
  变异核过：把 `P70` 从 `HARD_GATE_RULES` 里摘出去 → **只有这一格红**
  （`expected [ 'P70' ] to deeply equal []`）。
- 同批变异：把 `check-file-structure.cjs` 的 R5 拒涨分支短路成 `false && …` →
  **只有 R5 那两格红**，`check-infra-file-size.cjs` 那两格照绿（同维度分档的两家
  互不顶替）。

## Docs

- 规范 §11.25 的两张表扩成**四张**（新增 `RETIRED_RATCHETS`），并把「两格的卡点各是什么、
  怎么消掉的」与「上限收到 0 的理由」写进去；变异清单同步 +2 条。
