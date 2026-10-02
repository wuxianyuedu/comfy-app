## Changed

- `pnpm doc:check`（`scripts/check-doc-references.cjs`）从「手动档」接进
  `.githooks/pre-commit` 的 D 组，作为静态判据「文档引用与权威源一致」（ISSUE #1371，签字翻档）。
  旧口径写在两处：脚本头「`pnpm doc:check` 手动命令，不接 pre-commit（避免过度打扰提交）」
  与规范 §13「谁在跑什么」表里那行「本地钩子里没有它，改了文档/权威源后需手动跑」。
  翻档依据是实测而不是感觉：这条判据 **0.64s、零网络、纯本地文本**（`time node …` → real 0m0.640s），
  而 §13.5.4 把「不进钩子」的理由记在**网络与耗时**上（`dependencyAudit` 才是那一档）；
  真正的空档在别处 —— AGENTS 规定的必跑口令是 `pnpm doc:render`，它只做「源 → 生成物」、
  **不跑本校验**，所以按规范走的人一路绿灯提交，存量要靠事后单独一刀清
  （历史证据：`c4d414d5 fix: 清理 doc:check 存量的 splash 裸值并补并行引用点校验`）。
  它管的东西不是排版：占位符裸值回潮、文档里的端口与权威源不符、文档指向不存在的路径、
  台账里出现 `npm run`/`npx`（硬规则 1）、AGENTS.md ↔ standards 漂移、新增文档未登记进
  `SCOPED_DOCS` 也没有豁免。
- 新步骤**追加在 D 组末尾**而不是插中间：文档里有「pre-commit 第 N 步」这种按序号的引用，
  插中间会让它们一次性全部错位（那批序号本身已与钩子对不上，另账处理，见 ISSUE #1371 末段）。
- 钩子注释里那句「D(**25** 个判据脚本)」同步改成 26 —— 这个数字原先没有任何判据核，
  是现成的陈旧陈述制造机；现在它由用例钉住（见下）。
- **守钩子自身的判据收进 `FIXED_STRUCTURAL_TESTS`**（`scripts/affected-tests.mjs`）：改
  `.githooks/**` 会让增量层「放弃收窄、只跑固定清单」，所以这类判据只有进固定清单才有执行者。
  这条是接线之后量出来的（原来那组断言留在 `tests/check-doc-references.test.ts` 里，
  改钩子的那次提交一条都跑不到），规范 §13.5.8 补了连带要求与实测读数。
- 顺手核到一处陈旧计数：§13.5.8 末尾「`tests/affected-tests.test.ts` 钉住（**17** 条）」，
  实测 `pnpm exec vitest run tests/affected-tests.test.ts` → **20 passed**（17 是 E3‴/F13
  两刀加用例之前写的）。改成 20 并写明「这个数没有判据核，改数量时顺手同步」。

## Added

- `tests/doc-check-hook-wiring.test.ts`（3 条，进固定清单，实测 7ms）：
  ① D 组**解析出来的步骤**里有且只有这一条指向 `scripts/check-doc-references.cjs`，标签也对；
  ② 脚本头不许回退到「不接 pre-commit（避免过度打扰提交）」那句旧签字；
  ③ 钩子里那句「D(N 个判据脚本)」的 N 必须等于解析出的步骤数。
  ③ 是这一刀顺手补的元判据 —— 计数陈述没有别的执行者会核，改一次就悄悄过期
  （同族教训：清单/豁免项/提示里的路径也是代码）。

## Verified

- 判据有效性先测后接（它不是死判据）：在一份 scoped 文档里种一条 `npm run test:e2e` ⇒
  `[doc:check] ✗ [docs/standards/15-附录.md:210] 出现 npm/npx 命令…请改为 pnpm…`、真实退出码 1；
  还原后退出码 0。顺带量到匹配面 `NPM_CMD_RE = /(^|[\s`(（])(npm\s+run|npx)\b/` 要求词边界
  （第一次探针少了空格所以没命中），而「描述该规则本身」的句子带纠正词即豁免，不会误伤。
- 存量 = 0 才升硬闸：接进钩子前 `pnpm doc:check` 在 master 上为绿，且**合进最新 master
  （518d1747，别线刚动了 5 篇文档）之后仍为绿** —— 不是「带着别人的存量上闸」。
- **执行者实测**：`node scripts/affected-tests.mjs --changed .githooks/pre-commit`
  收录前 17 个 / 收录后 **18 个**，且新增那份在清单里（`mode: "all"`，只跑固定清单）。
- **两种变异都要红**（第一次变异只红一条，暴露了 `toContain` 的漏洞）：
  ① 删掉钩子里那一行 ⇒ ①③ 两条红、② 不受影响；
  ② 保留那一行但在前面加 `# ` 注掉 ⇒ 旧写法（`toContain`）**仍然绿**，
  改成按行首锚定解析 `  run "<标签>" <命令>` 之后 ①③ 同时红，报错文案分别是
  `D 组 25 步里没有 doc:check` 与 `钩子注释写 26，实际 25`；还原后 3 条全过。
  结论：在场判据必须解析、不能按字面量包含 ——「把这一步静音」正是它要拦的动作。
- 端到端：本 PR 的两次提交各自经过新钩子执行 —— pre-commit 的 D 组输出里出现
  `── check: 文档引用与权威源一致`（组内第 26 行，全部通过 ✓）。
- 用例与静态检查：`tests/doc-check-hook-wiring.test.ts` 3 条 + `tests/check-doc-references.test.ts`
  29 条 + `tests/affected-tests.test.ts` 20 条全过（合并后共 52 + 20）；
  `pnpm doc:render` + `doc:check` 绿；`tsc --noEmit` / `eslint --max-warnings 0` / prettier 棘轮全过。
- 文档同步：脚本头（含翻档理由与 0.64s 读数）、§13「谁在跑什么」表那一行、
  `docs/README.md` 命令表的「何时跑」（由「巡检收尾必跑」改成「每次提交」）、
  §13.5.8 两段（固定清单的连带要求 + 解析而非 `toContain`）；生成态 `docs/generated/13-*.md` 已重渲染。
