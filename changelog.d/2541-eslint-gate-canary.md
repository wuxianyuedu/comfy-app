## Fixed

**eslint 档位补阳性对照：`scripts/eslint-gate-canary.mjs`（ISSUE #2541 收尾）**。

### 症状（为什么要补这一条）

#2541 的本质是「空集意义上的 0 警」：core 面规则一条都没跑过，却报了 0 条。
三批之后（#2583 / #2585 / #2596）全仓又回到 0 警 —— 但「0 警」是**状态**不是
**能力**：它同样可能来自规则没生效、配置顺序被改反（`js.configs.recommended`
必须在前、接管的 off 块在后）、或 `files` 面收窄把被测目录漏掉（`.storybook`
就是那一类，见 #2614）。全仓绿说明不了「违规会被拦下」。

### 做法（与 `spawn-shell-scan.mjs` 同形）

- 造 11 份**已知违例**样本（TS 面 10 条 + scripts 面 1 条），用**本仓配置**真跑
  eslint，断言目标规则命中：`no-useless-assignment`、`preserve-caught-error`、
  四条 unicorn、`no-control-regex`、`no-irregular-whitespace`（代码位置，注释/模板
  那两档由 skipComments/skipTemplates 放过）、`no-useless-escape`、`no-regex-spaces`、
  `no-unused-vars`（scripts 面）；
- **反向对照**：干净样本必须 0 命中（闸若过宽，干净样本也会红）；
- **阴性对照**：`no-undef` 对 scripts 面是刻意关停的，不许反过来把 Node 全局判出来；
- **`--sabotage <ruleId>` 自测口**（这一格自己的阳性对照）：临时关掉一条在守的规则
  ⇒ **必须退 1**。恒绿的对照等于没有对照。闸门走 eslint 的 CLI `--rule` 覆盖，
  不落任何临时配置文件、不碰工作树；且只跑最小集（调用 6→4 次）。

### 为什么必须落真文件

`eslint@10` 的 project service 要求文件在 tsconfig 的项目里（实测 `--stdin
--stdin-filename` 报 `was not found by the project service`），所以样本写在仓库内
常规目录（`tests/` 与 `scripts/` 各一个临时目录，跑完 `finally` 里删），文件名不能以
点开头（TS 的 glob 默认跳过点目录）。

### 判据落点

`tests/eslint-gate-canary.test.ts` 三条用例钉住：默认退 0 且样本数达标 /
`--sabotage` 在守的规则必须退 1 / `--sabotage` 不相干的规则仍退 0（闸门不误伤）。
登记进 `scripts/fixed-structural-tests.mjs` 固定清单：触发面是「有人动
`eslint.config.js`」，而配置住在仓库根、判据住在 tests/，import 图追不到；且那种
改动**往往正是为了关掉某条规则**，此时「只在受影响时才跑」恰好把自己排除在外。

### 耗时（实测，写进测试注释）

单次 eslint 调用的 project service 冷启动是大头：沙箱单跑一次 ~24s，默认那条（2 次
调用）48–81s，4 个重文件并发时极端值 398s ⇒ 用例超时给到 600s。CI 上快数倍。
并发实测 canary + `tests/affected-tests.test.ts` 两文件 44/44 绿（280s）——
不给「受影响用例」格添新的假红（同族教训见 #2606）。
