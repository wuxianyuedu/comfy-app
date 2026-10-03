## Changed

- **`docs/standards/11` §11.7 不再抄门禁清单，也不再写步数**（ISSUE #1407，签字口径 (a)）。
  那节原来写着「`.githooks/pre-commit`（24 步）」并抄了清单的前 6 行 —— 而当天钩子的真实形状是
  **组 0 + A + B + C + D，D 组 27 条**（`grep -c '^  run "' .githooks/pre-commit` = 27，
  这数字由 `tests/doc-check-hook-wiring.test.ts` 与钩子注释那句「D(N 个判据脚本)」逐字核对）。
  也就是说那句**当场就已经是错的**，而且没有任何东西会变红 —— 步数既不是序号也不属于任何事实核。
  现在只留指针：清单的唯一出处 = §13.1 / `.githooks/pre-commit`。
  同批把两段历史读数里的「（27 步）」「（30 步）」也去掉（那是两份已删流水线当年的数字，
  留在活文档里只会变成第二个会过期的数字；要查归 `git log`）。
- **为什么不留「保留示例、只删数字」那一档**：#1404 给「§13.1 清单 = 钩子 D 组」装判据时顺带照出，
  连**权威清单自己**都漂了 5 步。副本比原件更难保持正确，删掉副本比给副本装判据便宜。

## Added

- `scripts/check-doc-references.cjs` 新增 `checkGateChecklistMatchesHook()` 的第二条姊妹判据
  `checkGateStepCounts()`：同一行出现**裸计数**（`24 步` 这种）与门禁锚点
  （`pre-commit` / `.githooks` / `CI`）即报错。与「不写第 N 步」那条（`checkGateStepIndexRefs()`）的分工：
  命中「第 N 步」的行交给那条报，**本条不双报**；豁免集合两条共用，本刀往里加了 `不再` / `过期`
  两个纠正词（否则描述这条口径本身的句子会把自己判红 —— #1374 就踩过这个形状，这次先想清楚再跑）。
  执行者与前两条同一个：D 组「文档引用与权威源一致」，每次提交都跑。
- `tests/check-doc-references.test.ts` 新增 8 条（该文件在本刀改动面上，钩子那一步也会真跑判据本体）：
  接线（`isCalledInMain`）+ wired/muted 对照、扫描面存量 = 0（带 `scanned > 20` 防空转）、
  种一条「`.githooks/pre-commit`（24 步）」→ 红并点名行号、同一行是「第 41 步」时**只由序号那条报**、
  描述本口径自身（带纠正词）→ 放行、`prepare-local-run.ps1 一共 8 步` 这种**有主人的过程计数** → 不误伤、
  §11.7 那段不许再长出 `✅ …` 命令副本（范围只截到「需要完整验证」之前 —— 后面那段是 11.7 自己的
  手动档建议，不是钩子副本）。
- `docs/reference-facts.md` §3.7 与规范 §13.5.10 各加一段「序号的近亲：步数也不写」，
  连同现场读数与两条边界；`docs/generated/` 两份同名产物随 `pnpm doc:render` 一起更新。
