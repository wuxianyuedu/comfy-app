## Fixed

- **一批「文档指着的文件/入口已经不长在那儿了」的陈述**，改法与上一批同源：对着现树复算，
  然后把指针改到真实位置；不新写任何数字。
- `docs/standards/07-日志系统.md` §7.10 那段示例代码与 `docs/standards/launch-and-build.md`
  §4 的日志布局表都写 `src/lib/app-runtime-log.ts` —— 真实位置是
  **`src/lib/log/app-runtime-log.ts`**（`#565` 那次 `src/lib` 域化把它搬进了 `log/`，
  现树里 `src/app/api/logs/app-runtime/route.ts` 就是那么 import 的）。
  ⚠️ 那一行还带着**第二种错**：示例写 `from "@/lib/app-runtime-log"`，而本仓 R13 只认
  `~` 前缀（真实 import 是 `~/lib/log/app-runtime-log`）——照抄那句话的人既拿不到文件、
  又会当场被 `scripts/check-import-alias.cjs` 拦下。一处缺陷两种形态，全改。
- `docs/guides/PRODUCTION-GAPS.md` P0-3「客户端崩溃上报」这条**计划里的文件名与接线方式**
  都过期了（它推荐补 `src/sentry.client.config.ts`，并「在 `instrumentation.ts` 的
  `register()` 里按 `NEXT_RUNTIME === "browser"` 挂上」）。按已装的 `@sentry/nextjs`
  **11.4.0** 复算：客户端入口叫 **`src/instrumentation-client.ts`**（包里这个名字出现
  39 次，而 `sentry.client.config.ts` 只剩「检测到旧文件 ⇒ 客户端重复 `Sentry.init()`」
  那条告警的兼容面），并且这一份是 **Next 自己加载**的（本仓锁定的 next 里有
  `node_modules/next/dist/lib/require-instrumentation-client.js`），不经 `register()` —
  那个 `register()` 只管 `nodejs` / `edge` 两支。**照旧话做会两头做错**：文件名落在兼容面、
  挂载点挂在不加载客户端的那一支上。
- 同一张台账里 A10 那条（已勾销）写「`src/server/api/routers/post.ts` **现**只剩
  `getLatest` / `create`」—— 那整个脚手架口随 E3「零执行者的死口」那一批（`8e0ceb07`）
  删净，文件已不在树上。改成「写这条时还剩那两条；后来整口删净」，勾销所判的
  「不在路由表」那一格不受影响。
- `docs/standards/12-代码组织与文件结构.md` 讲「`src/trpc` 为什么被补进零消费扫描范围」
  那段点名 `src/trpc/server.ts`（一条完整的死链路）。句子本身是**因**的记录，但它现在读起来
  像文件清单 ⇒ 补一句「当场被删、已不在树上」，免得有人按这个名字去找一个不存在的入口。
- **复算的方法与它没查出来的东西**（都记下来，免得下一条以为这几格判过了）：
  - 路径：取文档里全部 842 条 `xxx/…ext` 形态引用逐个 `test -e`，53 条不在树上 ——
    逐条读上下文后**绝大多数是正确的历史自注**（已删的基线 `scripts/.X-baseline.json`、
    `material.ts` 的删除记录、`WorkflowCanvasDecorations.tsx`「那个路径下从来没有文件」、
    `docs/SKILL.md` / `docs/conf.py` 是我这条正则吃进邻居字符串的假阳性）。真缺陷就是
    上面这几条。另：`tools/scripts/*.ps1` 那一批全部命中 —— 别把
    `scripts/X` 当独立检索式，它会命中 `tools/scripts/X`。
  - 命令名：文档里的 `pnpm <名字>` 逐个对 `package.json` 的 `scripts` ——
    `check:visual` / `test:visual` 都在「已随像素档删除」的叙述里 ✓；
    **`pnpm tauri` / `pnpm playwright` 都不是脚本名但实测能跑**
    （`tauri-cli 2.12.1` / `Version 1.63.0`，pnpm 回落到 `node_modules/.bin`）⇒ 不是缺陷。
    口径：**别只按脚本表判一条命令有效性**。
  - 跨文件锚点：把 `path#slug` 全部按「目标文件的真实标题重算 slug」对了一遍，
    **0 条对不上**（含上一批改过标题的那条 `#110-…`，等于顺手自证了那次改写落对了）。
    局限写在这儿：我的 slug 是按 GitHub 规则重推的近似，它证的是「文档写的锚点与某个真实
    标题同形」，不等于平台一定这么编码。
- **这一族同样没有任何判据会红**：`check-doc-references.cjs` 核路径存在性的覆盖面是
  **AGENTS.md** 里的反引号路径与 markdown 链接目标（C1），以及 `§NN.M` 标题锚点（C2）——
  `docs/**` 正文里的路径与 `#slug` 都不在判决面内。
- 遵循：AGENTS 硬规则 11「迁移目录连带五查」第 5 项（规范与碎片里的路径引用，本来就是
  手工动作）、硬规则 23 与 §12.4.6（示例保持中文注释）；口径同 §12.12「一份事实一处出处」。
- 复算：`pnpm doc:render` 后 `docs/generated/**` 与源同批、`render-doc-placeholders --check` ✓；
  `pnpm doc:check` 退 0。
