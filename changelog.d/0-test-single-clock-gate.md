## Added

- **新判据 `scripts/check-test-single-clock.cjs`（硬闸，已接进 `.githooks/pre-commit` 的 D 组）**：
  给规范 11 §11.14 新立那条「一个用例一把时钟」口径补上机器执行者 —— 它此前只有文档，
  与 `check-theme-colors.cjs` 之前那两句 ❌ 是同一种债（主张没有执行者）。判两条：

  · **规则 A**：同一用例体内，真实时钟等待（`expect.poll(` / `await waitFor(`）早于
    `vi.useFakeTimers()`。这种形状里那条用例的耗时是「机器当下给多少算多少」，而
    `testTimeout` 有上界；一旦越过，被抛下的 continuation 落进**下一条**用例的假时钟窗口
    ⇒ 负载下症状成对（先 `Test timed out in 30000ms`、再 `Timer APIs are not mocked`）。
    本刀前两条被拦下的真实用例（设置页 Ollama 轮询）实测读数：旧形状 1301 / 2419 / 3895ms、
    改后 568 / 768 / 769ms（16 核 + 24 个忙等进程，各 3 个配对样本）。
  · **规则 B**：`expect.poll(` 落在假时钟窗口之内 —— 它不推进假定时器（会自推进的是
    `vi.waitFor`），那种组合只能等到自己的预算用尽。窗口开在 `beforeEach` / 顶层时，
    按 `describe` 归属罩住该作用域里的每个用例体（**不能**按「源文本里下一处
    `useRealTimers()`」算尾，否则最危险的一档会静默不响 —— 第一版就是这么把自己判死的）。

- **两条边界各有反向样本钉着，不判的比判的多**：挂载发生在换时钟之前**不算**违规
  （挂起的是等待，不是挂载；全仓还剩 1 处那种形状且是正当的）、隔壁 `describe` 的窗口
  **不算**、窗口内的 `await waitFor` **不算**（那是 `check-test-waitfor.cjs` 列为正当的一档）、
  注释与字符串里的标记 **不算**、`vi.waitFor` 与裸 `setTimeout` **不重复立案**（分别有主）。
- **`tests/test-single-clock-gate.test.ts`（进固定清单）**：该拦的两条 + 该放的六条
  （挂载位置 / 隔壁 `describe` 的窗口 / 窗口内 `await waitFor` / 注释 / 逃生位 / 正当形状）、
  `it.each([...])(...)` 的两段式括号、历史形状原样回放（`try / finally useRealTimers` 那一格，
  顺带钉住「数站点行而不是数判据文案里的字样」—— 第一版断言就是拿 `not.toContain("规则 B")`
  判的，而解释文案里就有这四个字）、`--report` 与夹具自跳过。
  其中「两份文件各一处越界 ⇒ 两份都被点名」那一格是量具自证：模块级 `/g` 正则的
  `lastIndex` 残留会让「全仓只看得到第一份文件」**绿着** —— 本判据的第一版正是这样
  把自己的规则 B 静默判死，被这一格抓回来的。
- 登记：`.githooks/pre-commit` 的 D 组步骤（那句 `D(N 个判据脚本)` 同步 +1，由
  `tests/doc-check-hook-wiring.test.ts` 核与实际步骤数一致）、`scripts/fixed-structural-tests.mjs`
  的固定清单、规范 11 §11.14 与 13 §13.5 的门禁清单。

## Fixed

- **规范 11 §11.14 那条「『至少发生过一次』不是落定」明写「没有机器执行者，而且不要为它
  写一个」**：判「基数取早了」要先知道哪个位是这次动作的落定信号，那是语义不是形状，
  拿启发式扫必然误报一片（§12.18 明写别再为「该不该」造扫描器）。同节因此点名：能机判的
  是隔壁那条混时钟的，它现在有硬闸。
