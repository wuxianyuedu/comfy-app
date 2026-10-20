## Fixed

- **`docs/standards/07-日志系统.md` 里四处「曾经真、现在不真」的陈述**，全部对着现树复算过再改：
  - `§7.15` 把 `src/lib/log-session-scope.ts` 写成现状路径 —— 那个文件在 #565 的域化里
    已搬进 `src/lib/log/`。改成「当时在根目录、现居 `src/lib/log/log-session-scope.ts`」，
    历史动作与当前事实各留一份。
  - `§7.15` 的 `LogEntry.origin` 枚举只列了 `dev` / `launcher` / `app` / `app-runtime`
    四支，而类型现在**六支**（`shell` / `shell-launch` 是壳侧那两路进来后加的）。
    改成**不抄清单、指向出处**（`src/components/studio/logs/log-types.ts`）。
  - `§7.15` 两处「四个（轮询）来源」同样随那支枚举过期 —— 而同一章 `§7.25` 早就写着
    「六个来源各自数自己那一份」。**这是章内自相矛盾**，不是笔误。改成不带数目的说法。
  - `§7.19` 那张计数表里「`all` + 四个来源」同一条病，改成「`all` + `LogOriginFilter`
    的其余取值」。
- ⚠️ **改的过程中撤掉一处我自己写错的修法**：先把「四个来源的文件都天生只含本次」
  泛化成「各来源都天生只含本次」，一查 `src/lib/log/log-paths.ts` 才发现壳那路
  `LAUNCHER_SHELL_LOG` 是**固定名** `dev-launcher-stderr.log`、不按次 —— 泛化等于
  把一条比原文更强的断言写进规范。退回成「参与行时刻裁剪的那几路」，范围与判据对齐。
  （**口径**：去掉一个过期数字时，别顺手把它换成一个更大的范围；泛化是第二处过时。）
- **一处判不了、刻意留着**：`§7.29` 那句「这四个来源是一次启动一份文件」指的是服务页
  `log/current/services/` 那一族，其真实族数要顺着 `RUNTIME_LOG_SOURCES` 算（定义不在
  `log-paths.ts` 里），没算出来之前不改 —— 拿猜测替换猜测比留着更坏。
- **这类东西没有任何判据会红**：`check-doc-references.cjs` 核的是路径与硬编码值
  （这四条它一条都不报 —— 前两条路径确实存在、后两条不是路径），而 AGENTS 硬规则 11
  「迁移目录连带五查」的第 5 项（规范与碎片里的路径引用）本来就是**手工**动作。
  所以文档里的枚举与计数是一处会静默腐烂的面，改法是**不抄清单、指向出处**，
  而不是把它抄得更勤。
- 复算：`pnpm doc:render` 后 `docs/generated/07-*` 与源同批；`check-doc-references.cjs` 退 0；
  `tests/check-doc-references.test.ts` + `tests/docs-candidate-hygiene.test.ts` 共 **60 条全绿**。
