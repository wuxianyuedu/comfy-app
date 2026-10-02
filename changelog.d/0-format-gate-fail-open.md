## Fixed

- `scripts/check-format.cjs`（prettier 格式棘轮）有一条 **fail-open**：prettier 没跑成时
  会被读成「全库干净、门禁 OK」。具体机制：门禁经 `pnpm exec prettier` 起进程，
  命令找不到时（沙箱 / 依赖未装 / pnpm 形态选错）报
  `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`、**退出码 1、stdout 为空**；而脚本按
  「退出码 1 = 有差异，清单在 stdout」判读，空清单于是变成
  `[format] 扫描完成:未过 prettier 0 个文件（基线 0 个）` + `[format] OK` + exit 0。
  后果是这道棘轮在那类机器上**静默放行**，而 pre-commit 那行
  `[ok] ── check: prettier 格式棘轮` 一个字都不会说。
  发现路径值得记：不是格式投诉，而是 `tests/check-format.test.ts` 的三条「期望门禁拦住」
  的用例在提交门槛的多 worker 批次里**稳定红**、串行单跑却全绿 —— 红的是门禁的 fail-open，
  不是用例写得慢。
- 三条出路改成 fail-closed：prettier 入口解析不到 → exit 2；子进程被信号终止
  （`status === null`，含超时被杀）→ exit 2；**退出 1 却一行都没列出来** → exit 2 并附 stderr。
- prettier 不再经 pnpm 层起，改为 `node <本地 node_modules/prettier/bin/prettier.cjs>`
  （口径同台账 E10：平台 shim 那一层正是这类「起不来却被读成没问题」的藏身处）。
  脚本里那段为拿 pnpm 形态而做的 ESM 动态 import、以及用例夹具里为此拷进去的
  `scripts/launcher-core/` 一并删除。
- prettier 缓存从机器全局的 `os.tmpdir()/comfyapp-prettier-cache` 换成本次检出的
  `node_modules/.cache/prettier-gate.json`：门禁用例会并发搭临时沙箱，共用同一份缓存时
  读数不可信，且跟着用户走的缓存没法按检出隔离。

## Tests

- `tests/check-format.test.ts` 21 → 23 条：新增「入口取不到 → exit 2 且输出里不许出现
  `[format] OK`」「假入口退 1 而不列任何文件 → exit 2」。用例改由
  `COMFYAPP_PRETTIER_ENTRY` 这条接缝从真实仓借 prettier（沙箱里没有 `node_modules`）。
  变异实测：把「退 1 且空清单」那条规则短路 → 恰好新用例红、其余 22 条绿。
- 真实仓侧的行为回归由现有 21 条继续守：种一个未格式化的文件仍当场 exit 1 并点名文件
  （本次实现过程中实测过，不是只靠单测断言）。

## Docs

- 台账新开 **E11**；规范 §13.5.1 加一条「刻意的设计：命令没跑成不能被读成全库干净」。
  同族两处已核过、形态本来就安全（`check-reformat-only.cjs` 把非 0 一律当失败并退回逐文件
  兜底；`run-tests.mjs` 判 `result.error` 并透传退出码），记在 E11 免得下一批再找一遍。
