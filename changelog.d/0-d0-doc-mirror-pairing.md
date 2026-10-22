## Added

- **D0 形态档多一条判据：改了文档源就必须同批带上它的生成态镜像**
  （`scripts/check-doc-mirror-pairing.cjs`，钩子标签「文档源 ⇄ 生成态镜像同批」）。
  它判的是**提交的形态**而不是内容：一次 `git diff --cached --name-only -z` 加一次集合比对，
  暂存面里出现 `SCOPED_DOCS` 的某份源、却没出现 `docs/generated/<同名>` 时退 1 并点名那一对，
  出路写死成 `pnpm doc:render` +「不要手改生成物」。实测 0.28s（含 node 启动），
  与 D0 里那两条 CHANGELOG 判据同量级（复算：`time node scripts/check-doc-mirror-pairing.cjs --staged`）。
- **为什么这一条必须回到本地，而它那两个同类判据仍在平台**：平台那一格
  `生成态文档与源同步` 跑的是 `--check --autofix`，**就地修好再判** —— 于是「改了源、
  没带镜像」在平台的读数里从不出现。唯一还照得出它的是 `受影响用例` 那格里
  `tests/check-doc-references.test.ts` 的「绿的时候不多写」，而那一格按**增量面**命中，
  红就总落在**下一个动文档面的人**身上（2026-10-21 一天内三次，每次吃掉一次 CI 往返，
  红话指着那个人根本没碰过的文件）。漏做的那个人本地全绿、平台也全绿 ——
  这是「判据写了、执行者不在改它的那个人身上」那一族，不是「下次记得」能收掉的。
  内容一致性仍归平台那格判（那边才有可写的产物）。
- 「源 → 镜像」那条映射收成一处：`scripts/doc-facts.cjs` 新增 `generatedPathFor()`，
  渲染器与这条判据都取它。两边各写一遍 `path.join(产物目录, basename)` 早晚会在
  「两份源映射到同一个产物名」那类形状上分叉，而那正是这条判据的对象。
- 自测 `tests/check-doc-mirror-pairing.test.ts`（8 条）：六个方向（漏带 ⇒ 拦且点名那一对、
  同批 ⇒ 放行、只改镜像 ⇒ 不判、不在 `SCOPED_DOCS` 里 ⇒ 不判、删源/改名 ⇒ 同样要同批、
  暂存为空 ⇒ 说「没有什么可判」而不是「已通过」）+ 两条接线（这一步在钩子里在场；
  映射只有一处）。夹具用 `createGateRepo()` —— 这条判据的被测输入就是暂存区本身。
- 注册表面同步：钩子 `D(N 个判据脚本)` 的 N、`tests/commit-gate-tier.test.ts` 的总数与
  本地档边界、`tests/doc-check-hook-wiring.test.ts` 的 `FORM_PREPASS` 名单、
  §13.1 清单那一行，四处一并改（少任何一处都是一条静默漂移）。那几句引用旧条数的散文
  改成不写数字的形态 —— 数字由 `localTierLabels()` 现取，正文抄一份就是第二次脱钩的起点。
- 顺带把主干上又落后两份的镜像补回（`docs/generated/11-测试与可观测性.md`、
  `docs/generated/13-提交与-code-review.md`）—— 本批改了它们的源，正是这条判据要拦的那件事。
