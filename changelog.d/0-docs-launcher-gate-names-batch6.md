## Fixed

- **`docs/standards/launch-and-build.md` §5 排障表里两行的「已修」半句，点的是两个不存在的函数名**
  （`Test-ToolchainGate` / `Test-DevDependencies`，全代码树 0 命中）—— 那是 `.ps1` 时代的形状，
  编排搬进 `.mjs`（硬规则 12：`.ps1` 只做入口）之后换了名字与层次，读者照这两个名字去找代码
  会一无所获，而「已修」半句是这一族里最承重的部分（它回答「这条现在靠什么挡」）。改成现树落点：
  - 工具链那一格：`launcher-core/preflight.mjs` 的 `runToolchainGate`（弹壳之前），探测走
    `corepack.mjs` 的 `probePnpm`，判到可修 `preparePnpm` 重建缓存**并复核**
    （`shouldRepair`，复核不过不算修好），人这边同一份判据是 `pnpm check:toolchain`
    （`scripts/check-pnpm-available.mjs`）。附带纠一句：**「弹 MessageBox」那个形态已经不在树上了**
    （`MessageBox` 全树 0 命中），别照旧话去找弹窗。
  - 依赖残缺那一格：判据是 `launcher-core/worktree.mjs` 的 `verifyInstall()`
    （`.modules.yaml` + `.bin/next` + 关键依赖目录非空），补装是 `downstream.mjs` 的
    `syncDependencies`，**复核看 `verifyInstall()` 的结果而不是 `pnpm install` 的退出码**
    （§9.2 第 4 条），旁路入口 `pnpm deps:guard`。
- **同一格顺出第三条死指针**：原文让人去看 `log/current/launcher/pnpm-install-stderr.log` ——
  这个文件**不存在**：`src/lib/log/log-paths.ts` 里 launcher 那档只有固定名 `dev-launcher.log`
  （每次运行覆盖）与 `dev-launcher-stderr.log`，而 install 的输出尾部与复核结论走 `ctx.log`
  落进前者（`scripts/launcher-core/downstream.mjs:117`）。改成指真实落点，并明写「没有
  `pnpm-install-stderr.log` 这个文件，别去找」。
- **一条负结果（差点按旧账改错）**：`scripts/setup-comfy-cli-venv.ps1` 在我手上的旧清单里被记成
  「文档说它自动、其实不自动」。实测三件事把它推翻：文件**在树上**；
  `scripts/prepare-local-run.ps1` 在本地运行准备里调它（幂等、失败不阻断启动）；而它写明 Python
  版本下限、被 `tests/ci-env-probe.test.ts` 当**权威源**读（漂了就红）。所以 §5 那句「启动时后台
  自动完成」站得住，没动。**口径**：手上那份「已知待办清单」也要逐条复算 —— 它本身就是旧的，
  按记忆执行等于把一条过期结论再抄一遍。
- **这一族仍然没有任何判据会红**：`check-doc-references.cjs` 的 C1 只核 AGENTS.md 的路径、
  C2 只核 `§NN.M` 锚点；文档指向函数名/日志文件名既不解析代码也不解析日志布局。
- 复算：`pnpm doc:render` 后 `docs/generated/launch-and-build.md` 与源同批、
  `render-doc-placeholders --check` ✓、`check-doc-references.cjs` 退 0、
  `check-changelog-fragments` ✓、`tests/check-doc-references.test.ts` +
  `tests/docs-candidate-hygiene.test.ts` 全绿；两条表格行改完各仍是一行
  （`awk` 数行长 2542 / 2709，markdown 表格行不许断行 —— 断在表外没有判据会红）。
