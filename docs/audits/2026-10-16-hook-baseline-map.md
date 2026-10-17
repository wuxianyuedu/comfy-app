# 提交钩子基线地图（重构前的现状账）

> 生成时间：2026-10-16；数据源 = `.githooks/pre-commit`（**51 步 / 4 组**，逐条解析）
>
> - `.git/comfy-precommit-timing.jsonl`（本机逐步耗时账，**不入库**）+ 固定清单实际条数。
>   样本只有 9 次运行且跨 2026-10-13 → 10-15，期间这台机器被并行会话压过（同一天里
>   342s 与 5295s 都出现过）⇒ **下面的秒数是量级，不是承诺值**。重取：`pnpm exec node scripts/precommit-timing.mjs`。

## 一句话结论：墙钟由 C 组决定，不是那 51 步

| 组  | 内容                                           | 中位耗时 | 说明                                                                           |
| --- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| C   | 结构守护 + 受影响用例（**合并成一次 vitest**） | 1527s    | 9 次运行**每一次**都是最长组；中位占总时长 ~100%                               |
| B   | `pnpm run lint`（零警告）                      | 351s     | 范围沿用 package.json 的 lint 白名单                                           |
| D   | 其余静态判据 51 步，**组内串行**               | 295s     | 与 A/B/C 并行；步求和中位 243s ⇒ 组时长比步和多 18%，那部分是每步 spawn + 记账 |
| A   | `pnpm exec tsc --noEmit`                       | 152s     | 单步                                                                           |

总时长中位 **1529s**（最快 274s / 最慢 5295s）。**推论：想缩短提交，先动 C 组的输入面（固定清单 90 条 + 静态 import 图能追到多少用例），动 D 组只能省内存与噪音，省不了墙钟**（这条钩子文件头第 15 行已自陈：D 组贵的是串行 spawn 次数，不是判据本身）。

## D 组的真实分布（51 步）

- **49 步中位数 < 5s**；5–20s 的 4 步；≥20s 的 1 步。所以「步数多」不等于「贵」。
- 唯一的重脚：`jsx-a11y 规则开关⇄判据`（中位 31.3s，最差 63.3s）—— 它是"共进程 + 一次性真加载"换来的成本（§11.19.1 档 E），别退回成"再抬预算"。

| 中位≥5s 的步                              | 脚本                         | 中位  | min→max ×样本 | 触发面   | 档位（从脚本源码读，非注释自称）         |
| ----------------------------------------- | ---------------------------- | ----- | ------------- | -------- | ---------------------------------------- |
| `jsx-a11y 规则开关⇄判据（§6.12）`         | `check-a11y-rules.cjs`       | 31.3s | 21.6→63.3s ×9 | 每步都跑 | 无登记通道                               |
| `格式化提交与行为改动分离`                | `check-reformat-only.cjs`    | 11.2s | 1.2→61.5s ×9  | 每步都跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 |
| `翻闸旗标的散文承诺(硬闸)`                | `check-gate-flag-claims.cjs` | 10.8s | 7.5→23.4s ×9  | 每步都跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 |
| `文件结构硬规则(R1-R12，R5 硬闸)`         | `check-file-structure.cjs`   | 9.4s  | 7.3→32.7s ×9  | 每步都跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 |
| `故事面（title / 接上真组件 / 分组一致 /` | `storybook-check.mjs`        | 7.6s  | 6.0→23.7s ×9  | 每步都跑 | 无登记通道 / 读基线文件                  |

⚠️ 读这张表的两个坑：**①** 上表 `min→max` 的悬殊差多为**触发面命中与否**（未命中 ~1.2s 早退，命中 30s+），不是负载 flake —— 拿它当「判据不稳定」的证据会读错；**②** 有 `--update` 通道的棘轮，`--update` 那一支是否真能拒涨由 `tests/ratchet-update-guards.test.ts` 判，重构时别把这条通道接回已翻硬闸的判据上。

## 51 步逐条（顺序 = 执行序；D 组内串行）

| #   | 步                                                           | 脚本                                 | 触发面       | 档位                                     | 中位  | 分布       |
| --- | ------------------------------------------------------------ | ------------------------------------ | ------------ | ---------------------------------------- | ----- | ---------- |
| 1   | 文件结构硬规则(R1-R12，R5 硬闸)                              | `check-file-structure.cjs`           | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 9.4s  | 7.3–32.7s  |
| 2   | 跨平台动作对照(.ps1⇄.mjs)                                    | `check-ps1-consistency.mjs`          | 每次跑       | 无登记通道 / 读基线文件                  | 1.4s  | 1.1–6.7s   |
| 3   | AST 判据聚合（6 条共享一次解析）                             | `run-ast-gates.cjs`                  | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 2.0s  | 1.0–9.4s   |
| 4   | 标题行让位硬规则                                             | `check-title-bar-clearance.cjs`      | 动相关面才跑 | 无登记通道                               | 1.8s  | 1.0–5.9s   |
| 5   | UI/逻辑分离硬闸                                              | `check-ui-logic-separation.cjs`      | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.3s  | 2.2–14.5s  |
| 6   | CHANGELOG 碎片                                               | `check-changelog-fragments.cjs`      | 每次跑       | 无登记通道                               | 2.4s  | 1.2–79.8s  |
| 7   | 待发段落的来源锚 ⇄ 条目归属                                  | `check-changelog-versions.cjs`       | 每次跑       | 无登记通道 / 读基线文件                  | 1.6s  | 0.9–4.1s   |
| 8   | import 别名统一(~ 前缀)                                      | `check-import-alias.cjs`             | 动相关面才跑 | 无登记通道                               | 1.9s  | 0.8–5.7s   |
| 9   | 端口推导跨语言一致性                                         | `check-app-port-vectors.cjs`         | 每次跑       | 无登记通道                               | 3.0s  | 2.0–8.5s   |
| 10  | UI 基元复用棘轮                                              | `check-ui-primitives.cjs`            | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 1.7s  | 1.0–4.3s   |
| 11  | 主题色扫描                                                   | `check-theme-colors.cjs`             | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.2s  | 2.6–9.2s   |
| 12  | ComfyUI 端口口径一致性                                       | `check-comfyui-port-contract.cjs`    | 每次跑       | 无登记通道                               | 3.4s  | 2.5–13.0s  |
| 13  | 内联样式注入                                                 | `check-inline-style.cjs`             | 动相关面才跑 | 无登记通道                               | 2.3s  | 1.1–5.9s   |
| 14  | 跨文件重复块                                                 | `check-code-duplication.cjs`         | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 2.1s  | 1.0–6.1s   |
| 15  | 函数长度(硬闸，>400 行即阻断)                                | `check-function-length.cjs`          | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 2.1s  | 1.1–5.2s   |
| 16  | Rust 函数长度(硬闸，>120 行即阻断)                           | `check-rust-function-length.cjs`     | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 1.7s  | 0.9–4.4s   |
| 17  | 桌面壳（改了 src-tauri 才跑）                                | `shell-gate.mjs`                     | 每次跑       | 无登记通道                               | 2.5s  | 1.9–5.9s   |
| 18  | 模块循环依赖(硬闸)                                           | `check-circular-deps.cjs`            | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 2.3s  | 1.5–8.5s   |
| 19  | 入口重依赖静态可达性                                         | `check-barrel-heavy-deps.cjs`        | 每次跑       | 无登记通道                               | 3.3s  | 2.2–6.9s   |
| 20  | prettier 格式硬闸                                            | `check-format.cjs`                   | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 2.2s  | 1.2–49.7s  |
| 21  | 格式化提交与行为改动分离                                     | `check-reformat-only.cjs`            | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 11.2s | 1.2–61.5s  |
| 22  | 翻闸旗标的散文承诺(硬闸)                                     | `check-gate-flag-claims.cjs`         | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 10.8s | 7.5–23.4s  |
| 23  | 地基层零消费导出(硬闸)                                       | `check-dead-exports.cjs`             | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.6s  | 1.1–8.7s   |
| 24  | 浮层层级刻度硬闸                                             | `check-overlay-z.cjs`                | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 1.9s  | 1.3–3.6s   |
| 25  | ui/ 定制标记与台账（§16.8）                                  | `check-ui-customizations.cjs`        | 每次跑       | 无登记通道                               | 1.5s  | 1.2–3.3s   |
| 26  | 故事面（title / 接上真组件 / 分组一致 / 必填 props 的 args） | `storybook-check.mjs`                | 每次跑       | 无登记通道 / 读基线文件                  | 7.6s  | 6.0–23.7s  |
| 27  | 每档都有主（新鲜度账：e2e / 全量单测 / 产物三档自证）        | `freshness-gate.mjs`                 | 每次跑       | 无登记通道                               | 3.3s  | 2.0–18.4s  |
| 28  | 注释语言硬闸                                                 | `check-comment-language.cjs`         | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.4s  | 2.8–8.9s   |
| 29  | 用例环境档（环境早退 / 目录档矛盾 / 冗余文件头）             | `check-test-environment.cjs`         | 每次跑       | 无登记通道                               | 3.3s  | 3.0–5.9s   |
| 30  | 软断言用在循环体里（expect.soft）                            | `check-soft-assertions.cjs`          | 每次跑       | 无登记通道                               | 2.5s  | 2.0–5.0s   |
| 31  | 并发档位用法（it.concurrent）                                | `check-test-concurrency.cjs`         | 每次跑       | 无登记通道 / 读基线文件                  | 3.1s  | 2.5–6.2s   |
| 32  | 类型层断言的执行者（expectTypeOf）                           | `check-type-assertion-executor.cjs`  | 每次跑       | 无登记通道                               | 2.4s  | 1.9–4.7s   |
| 33  | 注解消费方（ctx.annotate）                                   | `check-annotate-consumer.cjs`        | 每次跑       | 无登记通道                               | 2.4s  | 2.0–5.8s   |
| 34  | 元数据消费方（task.meta）                                    | `check-task-meta-consumer.cjs`       | 每次跑       | 无登记通道 / 读基线文件                  | 2.5s  | 2.0–4.9s   |
| 35  | 未完成用例声明（test.todo）                                  | `check-test-todo.cjs`                | 每次跑       | 无登记通道                               | 2.6s  | 1.8–4.7s   |
| 36  | 判据执行者台账                                               | `check-gate-executors.cjs`           | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 1.4s  | 1.0–4.1s   |
| 37  | 声明 ⇄ 读者索引                                              | `check-declaration-readers.cjs`      | 每次跑       | 无登记通道 / 读基线文件                  | 1.3s  | 0.9–3.4s   |
| 38  | 按需档 ⇄ 执行者索引                                          | `check-on-demand-duties.cjs`         | 每次跑       | 无登记通道                               | 1.3s  | 0.9–2.6s   |
| 39  | 已知基线失败登记过期（清单为空时零耗时）                     | `check-known-failed-stale.mjs`       | 每次跑       | 无登记通道 / 读基线文件                  | 1.3s  | 0.9–2.2s   |
| 40  | 已知基线失败登记·自证（碰了这套机制才跑）                    | `known-failed-selftest-gate.mjs`     | 每次跑       | 无登记通道 / 读基线文件                  | 1.6s  | 0.8–3.8s   |
| 41  | 测试层裸 sleep 硬闸（§11.14）                                | `check-test-sleep.cjs`               | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.3s  | 2.4–5.1s   |
| 42  | 测试层 waitFor 边界（§11.14.3）                              | `check-test-waitfor.cjs`             | 每次跑       | 无登记通道                               | 3.6s  | 2.1–4.4s   |
| 43  | 测试层一个用例一把时钟（§11.14）                             | `check-test-single-clock.cjs`        | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 2.0s  | 2.0–2.0s   |
| 44  | 测试层 it.each（§11.15）                                     | `check-test-it-each.cjs`             | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.0s  | 2.1–5.6s   |
| 45  | 门禁自测临时仓库样板（§11.16.1）                             | `check-gate-repo-boilerplate.cjs`    | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 1.3s  | 0.9–3.2s   |
| 46  | 依赖新鲜度（只判动了依赖面的提交，§13.5.13）                 | `check-deps-freshness.mjs`           | 动相关面才跑 | 无登记通道 / 读基线文件                  | 2.7s  | 1.0–4.9s   |
| 47  | 依赖构建脚本与 allowBuilds 对账（只判动了依赖面的提交）      | `check-allow-builds.cjs`             | 动相关面才跑 | 无登记通道                               | 3.0s  | 1.0–28.7s  |
| 48  | jsx-a11y 规则开关⇄判据（§6.12）                              | `check-a11y-rules.cjs`               | 每次跑       | 无登记通道                               | 31.3s | 21.6–63.3s |
| 49  | 类型层声明 ⇄ 执行者（tsc 判决面，§13.5.14）                  | `check-tsc-diagnostic-executors.cjs` | 每次跑       | 有 --update 通道 / 自称硬闸 / 读基线文件 | 3.6s  | 2.4–6.2s   |
| 50  | 产品版本号三处同步(D7)                                       | `check-app-version.cjs`              | 每次跑       | 无登记通道                               | 1.6s  | 1.0–3.3s   |
| 51  | 基础设施层文件长度硬闸(scripts+tools，§12.6 R5 姊妹档)       | `check-infra-file-size.cjs`          | 动相关面才跑 | 有 --update 通道 / 自称硬闸 / 读基线文件 | 1.7s  | 1.2–3.4s   |

## 改钩子时必须一起动的元判据（它们看着钩子本身，漏一条就红）

| 元判据                                    | 它拦什么                                                | 你会在什么时候撞上它                                             |
| ----------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `check-gate-executors.cjs`                | 判定型入口必须有执行者                                  | 新增/删除一个 `check-*`，或把某步从钩子里摘掉却没交代新的执行者  |
| `check-gate-flag-claims.cjs`              | 散文里承诺的 `--update` / `--strict` 必须与脚本实际一致 | 翻闸、删旗标通道、或把「曾带 `--update`」写成现在时              |
| `check-gate-hint-targets-exist.test.ts`   | 红话术里点名的章节/脚本必须存在                         | 改判据输出文案、搬脚本路径                                       |
| `check-gate-repo-boilerplate.cjs`         | 门禁自测不许手搓临时仓库夹具                            | 重构时新写判据用例（走 `tests/helpers/gate-repo.ts`）            |
| D 组步数计数陈述                          | 「D(N 个判据脚本)」那句要等于实际步数                   | **增删任何一步都必须同批改那句计数陈述**（并行会话的判据会核它） |
| `tests/ratchet-update-guards.test.ts`     | 棘轮的「拒涨」那一支必须真生效                          | 给任何带基线的判据加/改 `--update` 分支                          |
| `tests/conditional-skip-registry.test.ts` | 条件 skip 必须登记档位+理由                             | 新判据要按平台/产物/环境跳过时                                   |
| `check-ps1-consistency.mjs`               | 跨平台动作两侧登记                                      | 新增 `.mjs`/`.ps1` 入口或改 `package.json` 脚本名                |

## 账实核对：#1975 挪走的三条（差集为证，不是听说的）

逐步账本里出现过、而现在钩子里已不存在的 label 恰为 3 条 —— `生成态文档与源同步`、`API 文档生成物与源同步`、`文档引用与权威源一致`，与 AGENTS 硬规则 7 新写的「三条挪到平台侧 `.cnb.yml`」逐条对上；反向差集（钩子里有、账本没样本）为 **0** 条。**这条核对本身值得留**：它同时证明「步数 54 → 51」不是解析误差。

## 别顺手做的一件事（实测过后果）

**不要把 `check-bundle-budget.cjs` 挂进 pre-commit 或 premerge 复算名单。** 在干净 worktree（无构建产物）里 `node scripts/check-bundle-budget.cjs` 实测 **EXIT=0** 并自报「跳过：`.next/static/chunks` 不存在」⇒ 挂进去等于加一条恒 0 的静默绿。要走这条路必须先把它自己的语义改成「产物不在 ⇒ 报未校验」。（台账 R13-01；体积确认归 ISSUE #1952 点名的那 9 条提交。）

## 重取这份数

```
node scripts/precommit-timing.mjs            # 近 N 次总时长 + 各组中位 + D 组前 10
git grep -c 'run "' .githooks/pre-commit     # 步数（当前 51）
node -e "import('./scripts/fixed-structural-tests.mjs').then(m=>console.log(m.FIXED_STRUCTURAL_TESTS.length))"   # C 组输入面（当前 90 条）
```

> 本文件是**一次性的重构前基线快照**（含 2026-10-13→10-15 的 9 个样本）。
> 步数、清单条数、组中位数都会随重构变化 —— 改完请用上表命令重取，并回来更新这张表，别让它变成第二条 R9-01。
