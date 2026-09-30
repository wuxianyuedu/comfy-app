## Added

- **组 A 失败时，门槛自己把「报错全在 Next 的生成物里」这一种情形点破**（ISSUE #1182 的方案 3；**共写本身没解决**，那条 issue 保持 open）。症状是长这样的：`git commit` 被 pre-commit 组 A 拦下，报 `.next/dev/types/validator.ts(80,46): error TS1005` / `(85,1): error TS1128`，而本次改动里没有任何 `.next` 文件 —— 人会先怀疑自己刚写的代码。根因是同一目录并发起第二个 `next dev` 实例时两个实例共写同一份 `.next/dev/types/`，而按硬规则 3 整树回收用的是 SIGKILL，落在写 `validator.ts` 的窗口里就留下一行被截断的生成代码；`tsconfig.json` 的 `include` 里**显式列着**那个生成目录（路由校验类型本来就该被检查），所以它必红。

  - `scripts/check-tsc-artifact-hint.cjs` 只在「有 `error TS` 行，且报错文件**全部**落在 `.next/` 这**一个目录段**」时打印成因 + 处置命令；其余情形完全沉默。它自身恒退 0，钩子里那一跳带 `|| true` —— 判决仍属于 tsc，这条既不许把红洗成绿，也不许变成第二种失败形态。
  - 沉默的口径是这条判据的全部价值：掺进一条真类型错就闭嘴（否则下次真错时没人再信它），一条 error 都没有（OOM、`tsconfig` 读不到、参数错）也闭嘴，`.nextify/` 这种同前缀目录不算生成物。
  - 处置命令那句 `rm -rf .next/dev/types` 是**先验证才印**的：`next-env.d.ts` 明确 `import "./.next/dev/types/routes.d.ts"`，直觉上删目录会把红从生成物搬到源码，实测不会（最小工程复现同形：缺生成目录时 tsc 对这行 side-effect import 不报错，exit 0）；提示里同时把「只删报错那个文件」这个最小动作排在前面。
  - 本地复演用的不是抄来的字符串：把真 `validator.ts` 第 79 行截到 `type __IsExpected<Specific extends AppPageConfig` 后跑 `pnpm exec tsc --noEmit --incremental false`，真 tsc 给出单行 `(79,51): error TS1005: '>' expected.` ⇒ 判据认得；按 sha256 还原后复绿。**单行也点破**是这次补的一条用例，半截文件报几行取决于断在哪。
  - 顺手一条：新脚本第一版没带 `// @ts-nocheck`，被组 A 当场判红（`include` 含 `**/*.cjs` + `checkJs: true` + `strict`）—— `scripts/*.cjs` 34 份里 31 份第二行就是它，这条惯例本来就由 tsc 守着，不需要新判据。
- 判据：`tests/check-tsc-artifact-hint.test.ts` 8 条（正向三份真读数 / 反向两类沉默 / 目录段边界 / CLI 读不到日志时静默退 0 / 门槛接线本身，接线那条把 `|| true` 一起写进正则）。排障口径同步进 launch-and-build §5 那一行（早有「整目录移走」的处置，本刀补上「门槛会当场点破」）与 P3 §5 ADR §26。
