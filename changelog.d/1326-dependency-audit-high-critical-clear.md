## Fixed

- **`master` 上 `check:all` 的「依赖漏洞扫描棘轮」常红：3 条 high/critical 全部修掉**
  （ISSUE #1326 存量红收尾）。这一条与用户报的另两条（`gate-executors` / `theme-tokens`）
  同批核过 —— 那两条**已经绿了**，见下面「核实结果」；只剩这一条还在红，所以本笔只修它。

  三条都是**传递依赖**、且父包声明的 range 都容得下修复版，所以走
  `pnpm-workspace.yaml` 的 `overrides` 顶到修复版（不是升级顶层依赖 —— 顶层升级既动不到
  它们，还会把无关的次版本跳变一起带进来）：

  | advisory | 包 | 修复版 | 引入链 |
  | --- | --- | --- | --- |
  | #1241210 critical | `proxy-addr` | 2.0.7 → **2.0.8** | `@modelcontextprotocol/sdk > express > proxy-addr`（express 5.2.1 声明 `^2.0.7`） |
  | #1241331 high | `sharp` | 0.35.4 → **0.35.5** | `next > sharp`（next 声明 `^0.35.4`） |
  | #1241209 high | `source-map-js` | 1.2.1 → **1.2.2** | `postcss > source-map-js`（postcss 声明 `^1.2.2`） |

  三条都取 registry 给的 `patched_versions` **最小可达版**（不写 `^x`：range 会让下一次
  install 悄悄跳到没人复核过的新版本）。`pnpm why` 三处各只剩一个版本；实测各自动真干活的
  **消费侧解析**（不是「装得上」）：`next` 侧 `sharp` 出件成功（png 96 字节）、
  `postcss` 侧解析到 `source-map-js@1.2.2`、`express` 侧解析到 `proxy-addr@2.0.8`。

  ⚠️ 台账里那条 `braces#1240992` **没动**：它的 `patched_versions` 在 registry 里是 null
  （上游无修复版），按 §13.5.9 继续留在台账、理由照旧有效。本笔只让「有修复版的三条」
  从「拦下所有人」变成「不存在」—— 台账不是赦免名单，`--update` 那条后门也没走。

## Docs

- `pnpm-workspace.yaml` 的 `overrides` 块补上这三条，逐条写清「引入链 + 父包 range +
  为什么走 override 而不是升顶层」，与块内既有条目同一形态。

## 核实结果（ISSUE #1326 里点名的另两条：已绿，未改一字）

用户要我开的这条是「`gate-executors` 在 D 组、`theme-tokens` 在 C 组的固定清单里，
让所有人的 pre-commit 失败」。实测**两条都已绿**，红线是 **2026-10-05 21:04 的两笔**
（都在我那句话写出来之前/前后脚），不是在 10-08 等我修：

- `tests/gate-executors.test.ts` —— 现场是 `.toBe(44)` 写死份数，`#1485` 新增一份
  `check-*` 后报「expected 45 to be 44」。修法是 **`5dff4577`（#1444）**：份数改成与
  「名字族 ∪ 门禁链事实」**独立数一遍**来对，不再写死数字（两向都咬）。
- `tests/theme-tokens-compile-source.test.ts` —— 现场是文件快照落后 4 颗
  `--color-glow-*`（`#1514` / `#1526` 加的，两笔都晚于该快照被引入的 `b3bf69fe`）。
  修法是 **`70aa61bb`（#1381）**：重录为 153 条。

复算手法（不是「看着像绿的」）：`git worktree add /tmp/wt-016 016345b9` 到**修之前**的
干净检出上跑同一条判据，两条**确实红**（`expected 45 to be 44` / 快照 diff 里正是那四颗
`--color-glow-*`）—— 也就是「红过」这件事成立，只是**在我说的那个时点上已经不再成立**。
现读数：`check-gate-executors.cjs --report` 报 48 份、`theme-tokens` 快照 153/153 一致，
`run-affected-tests.mjs --fixed-only` 的 38 份固定清单用例 **299 passed 全绿**。
