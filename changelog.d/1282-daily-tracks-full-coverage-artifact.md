## Added

- **「每天首次自证」从一档扩到三档：全量单测 + 覆盖率、产物级护栏也接上了同一份判决**
  （ISSUE #1282 的续；承 `#1545`/`#1547`/`#1282` 已有的新鲜度账）。
  立案现场是 §13.5.3 那张欠账表：平台流水线删掉（ISSUE #623）之后，两条判定档的**唯一执行者**
  是文档里那句「按需手动跑」，而那句话没有任何东西在守 —— 它正是在本仓库判过不止一次的形态
  （同 §13.5.12 的立案现场）。

  - **全量单测 + 覆盖率门槛**（`pnpm run test:coverage`，3000+ 用例 + 几十条按实测定的
    `coverage.thresholds`）：提交门槛（C 组）只跑固定清单 + 受影响用例，**不跑覆盖率** ——
    「改了 `src/lib/**` 的覆盖率相关分支、门槛悄悄跌破」这条路上一个判据都没有。
  - **产物级护栏**（`pnpm run build` + 数产物）：失效形态恰好是**不报错**的那两种 ——
    产物里多出 `.env`（硬规则 17）、Next 运行时脚本缺件导致「页面全 200、接口全 500」
    （硬规则 18），两者都只在**真构建过一次**时才有结论。

  判据的形状：**三档「每天首次」口径不同，判据一份**（`FRESHNESS_TRACKS` 的数据，不是分支）。

  - **全量 e2e**（`daily` + `dirty` 为空）—— 按**本地日历日**：当天第一次提交带一次凭证。
    它人人都跑得动，且结论与改了哪几个文件无关。
  - **全量单测 + 覆盖率 / 产物级护栏**（`daily` + `dirty` 非空）—— 按「**改了就当天跑**」：
    当天动过输入面（`src/`+`tests/` / 产物链那几个文件）就必须今天自证；没动过以 7 天为宽限。
    十分钟量级的两档**没必要每天都跑** —— 没碰 `src/` 的一天跑一遍，换来的是一个不会变的结论。
  - **两种「不跑」互不等于**：`--skip "<理由>"`（今天故意不跑）落 `skippedReason`、
    `--dirty "<理由>"`（这次改动不吃这一档）落 `dirtyReason`。混成一栏之后，「这一档三个月
    没跑」与「这三个月每次都声明不吃它」在账面上会长得一模一样。
  - **「先跑后改」也放行**（`freshnessVerdict` 里那一比）：早上跑完全量、下午再改代码是常态。

  顺手修掉的一处**静默失效**：判决面此前是**手抄**的（`{kind: "e2e", platforms: ["e2e"]}`），
  于是「新增一档却忘了在这一处加一行」⇒ 那一档**谁都不判**（判据的覆盖面与它自称的不符）。
  现在 `trackScopes()` 由 `FRESHNESS_TRACKS` 现算：新增一档自动被纳入。

  记账语义与既有两档**逐字同一份实现**（`writeFreshness` / `writeSkipRecord`，
  `scripts/visual-baselines.mjs`，§12.12）；四档共用的「解析 `--skip` / `--dirty` + 落账」
  收在 `scripts/daily-run.mjs`（`e2e-run.mjs` 的 `parseSkip` 也改成走它，函数签名不变）。

## Fixed（顺手接出来的两处静默失效）

- **判决面此前是手抄的**（`{kind: "e2e", platforms: ["e2e"]}`）⇒ 「新增一档却忘了在这一处
  加一行」会让那一档**谁都不判**。现在 `trackScopes()` 由 `FRESHNESS_TRACKS` 现算。
- **`freshnessRecord` 只透传 `skippedReason`** ⇒ `--dirty` 写下的那句会在这一步被静默丢掉：
  账面上剩一条没有任何理由的记录、而 `verifiedAt` 是今天 —— 判据当它「今天自证过」放行，
  一个看着正常的记录指的却是另一件事。现在两栏都列（用例钉住）。
- **`dirtySince` 的取证（`git log --format=%cI --name-only`）状态机写错过一次**：
  那段输出的形状是「时刻行 · **空行** · 文件行」，空行分隔的是**时刻与它的文件清单**，
  不是两次提交。第一版「遇空行就收段」会在文件行到达**之前**把时刻清掉 ——
  判据**每一次**都判成「今天没动过这一档」，而话术里一个字都不提（`tests/daily-tracks.test.ts`
  用真 git 输出的形状钉住它）。
- **宽限期此前只对 `track.daily` 生效** ⇒ 非 daily 档在账文件缺席时会直接判「没有记录」
  并阻断一件**本人做不到**的事（平台侧 squash 合并不跑本地钩子）。现在四档一视同仁。

## Added（接线）

- 两个跑法脚本与它们的 `pnpm` 入口：`scripts/full-suite-run.mjs`（`test:coverage:tracked` /
  `test:coverage:dry`）、`scripts/artifact-run.mjs`（`build:tracked` / `build:tracked:dry`）。
  两者都支持 `--dry-run`（只打印、无副作用）、`--skip`、`--dirty`。
- `scripts/affected-tests.mjs` 的 `FIXED_STRUCTURAL_TESTS` 加 `tests/daily-tracks.test.ts`
  （它读的是几份脚本与钩子接线文本，import 图追不到，必须无条件响）。
- 钩子 D 组那一步的标签改成「每档都有主（新鲜度账：像素档 + e2e / 全量单测 / 产物三档每日自证）」，
  `scripts/.declaration-readers.json` 那条登记同步改（`check-declaration-readers.cjs` 双向核对
  会报「判据在场、没人敲它」）。

## Tests

- `tests/daily-tracks.test.ts`（20 条）：四档的登记形状（四份账不共用文件、四个键互不相同、
  像素档不吃 `daily`）、判决面**由登记表派生**（新增一档自动纳入）、`dirty` 档的四种形态
  （今天有 / 今天动过没自证 / 没动过在宽限内 / 超宽限）、`dirtySince` 对不吃输入面的档
  **必须被忽略**、两条出路的解析与落账（含「两个开关互不串档」）、跑法各自的命令核、
  以及四档走同一份内核。
- 既有用例逐条核算过仍成立（`tests/e2e-run.test.ts` / `tests/visual-freshness-gate.test.ts`
  的关键断言逐条在本机手工复算；本机 `node_modules` 未安装，vitest 未实跑，这点请知悉）。

## Docs

- 规范 11 §11.8：两档对照表扩成四档，并补「三档口径为什么不同」「两种不跑互不等于」
  「先跑后改也放行」三条；§11.23 那张声明索引同步。
- 规范 13 §13.5.3 / §13.5.4：两条欠账条目改成「逐日自证 + 改了就当天跑」，并新增一张
  「五条按需档各自的执行者」表 —— 此前判据只答「为什么不进钩子」，不答「那谁在什么时候跑它」。
- `docs/guides/TESTING.md`：`pnpm test:e2e` 那一段扩成三档。
- `docs/standards/launch-and-build.md` §9.5：两条新动作各加一行（与 `e2e-run.mjs` 同款，
  Windows 侧暂无入口、`pnpm` 脚本两侧同形）。

## 说明

两份新账（`scripts/.full-suite-freshness.json` / `scripts/.artifact-freshness.json`）
随本 PR 入库，用 `--dirty` 记了理由：**本 PR 只接机制，未动 `src/` 功能链路、也未动产物链**
（`git status` 可核）。这是 `dirtyReason` 栏的正当用法 —— 它记的是「这次改动不吃这一档」，
与「跑绿过」在账面上读起来不一样。
