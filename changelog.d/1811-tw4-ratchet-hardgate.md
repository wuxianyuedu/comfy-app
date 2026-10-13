## Changed

- **tw4 两份「CSS 等价改写」判据从一个基线 `total: 0` 的棘轮翻成硬闸**（ISSUE #1811 的
  tw4 项）：`scripts/tw4-canonical-report.mjs` 与 `scripts/tw4-spacing-canonical.mjs` 都
  删掉基线（`.tw4-canonical-baseline.json` / `.tw4-spacing-baseline.json`）与 `--update`
  收紧档，`--check` 改为「候选数须为 0、命中即退 1」。存量清零后棘轮的两个动作都无事可做，
  留下的却是一条「手改那份 JSON 就能把新候选登记成已知存量」的通道 —— 那正是硬闸类本来
  没有的中间态（§13.6.2 的两类对照）。判据口径与扫描面一字未动。

## Fixed

- **tw4 两份工具的字符串字面量取法收成一个共享内核，并先剥注释**
  （`scripts/tw4-scan-core.mjs`）。此前两侧各写一遍「全文件正则」，于是注释里用反引号
  引的示例与真 className 同形、被当成候选（`repository-row.ts` 的 `` `!row` `` 就是这么
  报出来的），而 `--write` 还会去改注释里的示例。剥注释是逐字符状态机、保长保换行，
  行号不漂；JS/TS 走它，`.css` / `.snap` 仍按字面量粗取。
- **修好注释剥离之后浮出的两处真候选**：`WorkflowNode.tsx` 的 `px-[14px]` → `px-3.5`、
  `h-[43px]` → `h-10.75`。它们一直合规地存在，只是被上面那句正则被注释里的引号
  打乱配对之后整段漏掉了 —— 「判据报了不该报的」与「判据漏了该报的」是同一个根因的两面。
- **`AppShell.tsx` 的折叠标记隐藏写法改到 canonical 形态**：
  `group-data-[collapsible=icon]:[&_[data-slot=disclosure-marker]]:hidden` →
  `group-data-[collapsible=icon]:**:data-[slot=disclosure-marker]:hidden`（同一份 CSS，
  与仓内 `**:data-[slot=…]` 的既有写法一致）。

## Added

- **tw4 两份判据新增行为自测** `tests/tw4-hardgate-behaviour.test.ts`（进固定结构守护
  清单）：把两份工具当黑盒跑在临时工作区上，正面钉住「真候选即退 1」「注释里的示例
  不算候选」「`--update` 这个出口已经不存在」。形状守卫
  （`tests/tw4-canonical-ratchet.test.ts`）读的是文本，**判不出**判定档真的会退 1 ——
  一个把 `--check` 写成永远 `exit(0)` 的版本同样满足「有 `--check`、有
  `process.exit(1)` 字样」。
- `tests/helpers/gate-repo.ts` 的 `copyGateDeps` 补上 **ESM 形态的依赖**：
  原先只认 `require("./x.cjs")`，抽共享内核（`.mjs`）之后临时工作区跑起来是
  `ERR_MODULE_NOT_FOUND` + 一叠加载栈 —— 长得像「判据坏了」，实际是夹具少带一个文件。
