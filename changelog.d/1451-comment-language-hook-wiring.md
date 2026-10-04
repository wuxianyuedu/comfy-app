## Fixed

- **注释语言棘轮此前「判据在场、一个执行者都没有」，而文档处处说它在执行**
  （ISSUE #1451 / 规范 12 §12.4.6、13 §13.1、13 §13.5.10）。现场：`scripts/check-comment-language.cjs`
  头部自称「供 `.githooks/pre-commit` 与 CI 调用」、§12.4.6 也写着它「在 `pre-commit` 里报红」，
  而 `grep -c comment-language .githooks/pre-commit` 一直是 **0**，平台流水线又随 ISSUE #623 删除
  —— 一条基线为 `total: 0` 的硬闸**没有任何机器在敲它**。表现是：注入一行英文注释，
  判据自己会红（`exit=1`），但 `.githooks/pre-commit` 四组全绿放行。
  与 #1371（`doc:check`）、#1404（R5 `--strict`）同族，那两条各补了一条「在位判据」把步骤钉进钩子，
  这条漏了。

  - 把它接进 pre-commit 的 D 组，标签 **`注释语言棘轮`**（`run "注释语言棘轮" node scripts/check-comment-language.cjs`）。
    只接判定档：`--report`（盘点，恒 `exit(0)`）/ `--update`（收紧基线）/ `--strict`（未收紧即失败）
    都是人的动作，不进钩子。成本实测：1695 个文件的纯文本扫描 < 1s、零网络、纯本地，
    与 §13.5.4 给 `doc:check` 翻档同款判据（0.64s / 零网络），不构成「手动档」的理由。
  - 脚本头那句「供 …与 CI 调用」收敛为「供 `.githooks/pre-commit` 的 D 组调用」—— 现在这句是真的。

## Test

- **`tests/doc-check-hook-wiring.test.ts` 新增 3 条在位判据**（该文件本就是「D 组接线」那一格的载体）：
  解析 D 组步骤（`^ {2}run "<标签>" <命令>`，被 `#` 注掉不算在场）确认这一步在位且命令逐字不带 flag；
  并反向钉住脚本头不许去掉「供 `.githooks/pre-commit`」这句承诺。
  - **变异验证**：把钩子里那一行前面加 `# ` 注掉 ⇒ 2 条红（在位判据 + 「D(N 个判据脚本)」的计数陈述）；
    还原即绿（9 条全过）。
  - 钩子注释里那句 `D(N 个判据脚本)` 的计数随之 28 → 29（该断言本就由这个用例核对，
    「这数字没有别的判据核」）。

## Docs

- §12.4.6 补「执行者」一段：把「在 `pre-commit` 里报红」从**书面自白**改成**有执行者的事实**，
  并记下这次事故的形态（文档说谎而全绿）；§13.1 自查清单补一条「新增 / 改动的注释是中文」；
  §13.5 门禁清单补 `✅ node scripts/check-comment-language.cjs` 一行；`docs/generated/**` 已重渲染。
