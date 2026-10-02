## Fixed

- **C 组兜底的理由是假的，这次按实测换掉**（ISSUE #1393，签字口径 = 只修假前提、兜底先不翻）。
  `.githooks/pre-commit` 命中公共地基（`vitest.config.ts` / `tests/setup.ts` /
  `package.json` / lockfile / `tsconfig.json` / `.githooks/**`）时会「放弃收窄、只跑固定清单」，
  而这句话在四个载体上都写着同一个理由：**「全量当前带着别线的基线红」**。在 master `9392a88f`
  上重测，那个前提已经不成立：
  - `pnpm test`（配置里的 `maxWorkers: 8`）→ 559 份里**只红 1 条**，且那条是
    `Error: Test timed out in 30000ms`（`tests/ui-primitives-coverage.test.ts > ui/card …`），
    `--no-file-parallelism` 隔离重跑 65/65 绿；另有 1 条未处理错误
    `[vitest-pool]: Failed to start forks worker for test files …/LogPanel.test.tsx`
    把整份退出码打成非零。墙钟 707s。
  - `pnpm exec vitest run --maxWorkers=4`（钩子那一档）→ **560 files / 6887 passed + 23 skipped，
    全绿**，墙钟 **1949s = 32m35s**。
  - `scripts/quality-gate-shared.mjs` 的 `KNOWN_FAILED_FILES` 是**空数组**（`fbabbc25` 引入时就是空的）。
  ⇒ **真断言红 = 0**。假前提的害处不在于说错数字，而在于它每次 wide 提交都当着所有人的面重印一遍，
  久而久之就成了「谁也不去翻兜底」的默认解释，把一个已经消失的条件当成还没做完的理由。

## Changed

- `scripts/affected-tests.mjs`：wide 提示与文件头那段同句改成实测拦路石 ——
  ① 耗时（wide 那档跑全量 = 32m35s）；② 这一层没有全量通道（钩子刻意拒绝「空参数 = 全跑」，
  因为空参数意味着谁都没筛过、红了也归不到本次提交头上；把 559 个路径拼进 argv 在 Windows 上
  还会撞命令行上限）。文件头里那句「等基线红清零后改成跑全量」被替换成
  「重开这件事的条件是愿意付那半小时 + 先把通道建好，不是等基线红清零（那件事已经发生了）」。
- `vitest.config.ts` 的并发注释：原来抄了 §11.13 的三档表数字（`红 4 文件 / 14 用例`、`659s`、
  「超时类红归零」「买的是隔离重跑不再需要发生」）并据此下结论 —— 数字抄到第二处就会和那份表漂移，
  而结论今天被自己的复跑否掉：**8 档仍然需要隔离重跑定性**（红的形态从断言失败换成了争用超时 +
  池子起不动 worker）。改成只留结论 + 指针，表格归 §11.13 一份。
- 规范两处同步：§13.5.8 那段重写（含「为什么现在不翻」的两条与重开条件）；§11.13 在旧三档表后
  补本轮两档读数，并订正「只剩产物那 1 条、只在带 `.next/standalone` 的检出上才现形」——
  本轮就是在**带 standalone** 的检出上跑的，产物线全绿（`standalone-runtime-completeness` 9 条）。
- `.githooks/pre-commit` 的 C 组注释把指针写错了节（写 §13.5.4「按需召唤」，wide 那段实际在 §13.5.8）。

## Added

- `wideFallbackNote(note, count)`（从 CLI 里抽出来的纯函数）+ `tests/affected-tests.test.ts` 两条：
  一条钉话术内容（必须出现耗时与「空参数」，**不许**再出现「基线红」），
  一条钉「CLI 真的在打印这个函数」——只钉文本的话，抽出来的函数可以被人从调用点摘掉而全文本仍绿，
  那就是本线反复在收的「定义了却没人调用」那一格。

## Verified

- **前提是先量的，不是先写的**：上面四组读数各来自一次真跑（`pnpm test` / `--maxWorkers=4` /
  `--no-file-parallelism` 隔离重跑 / `ls .next/standalone` 确认产物在场），
  且都落在同一份 master（`9392a88f`）上。签字之前先把它们写进 ISSUE #1393 正文。
- **两种变异都要红**：① 把 `wideFallbackNote` 里的话术改回「全量当前带别线基线红」⇒
  「话术只写实测拦路石」红 1 条；② 把调用点那一行注释掉（函数还在、没人调）⇒
  「CLI 真的在打印」红 1 条。两种都还原后 22 条全过（原 20 + 新 2）。
- `pnpm doc:render` + `render --check`（30 份一致）+ `doc:check` 绿；
  `pnpm check`（eslint 零警告 + `tsc --noEmit`）过 —— 本轮动了 `vitest.config.ts`，
  类型面必须重跑而不是只看 lint。
- 端到端（走钩子的真实输入）：本刀同时暂存了 `.githooks/pre-commit` 与 `vitest.config.ts`，
  直接跑钩子 C 组用的那一条命令 `node scripts/affected-tests.mjs`（读暂存区），stderr 原文是
  `[affected] 放弃收窄（.githooks/pre-commit —— 门槛自身 / vitest.config.ts —— 全局测试配置
  （预算 / include / setupFiles））→ 只跑固定清单 20 个。兜底不是全量：wide 这一档跑全量实测要
  32m35s，而钩子刻意不接受「空参数=全跑」这种没人筛过的形态（真断言红已经是 0，不是挡路的那件事）。
  规范 §13.5.8 / §11.13` ⇒ 新话术确实是这一档被触发时打出来的那一行，不是只活在测试里。
  （钩子只在**组失败**时回吐该组日志，全绿时不打印 —— 所以这句证据取自上面那条同入口的实跑，
  不取自提交日志。）
- **没做的事**（写清楚，别当成已完成）：兜底仍不是全量；没有为「全量到底绿不绿」新写静态判据 ——
  它断言的是运行期与机器资源，写不出不误报的版本（同 #1315 / #1320 那条结论），走文档 + 实测复跑。
