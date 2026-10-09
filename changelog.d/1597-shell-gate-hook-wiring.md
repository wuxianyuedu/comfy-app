## Fixed

- **桌面壳门禁 `shell-gate.mjs` 的「接线」此前没有专守的在位判据**（ISSUE #1597 /
  AGENTS 硬规则 5、规范 11 §11.10.4、13 §13.1）。现场：这一步在 `.githooks/pre-commit`
  的 D 组里确实有，但没有任何判据钉住它 —— `tests/shell-gate.test.ts` 只有
  `expect(hook).toContain("node scripts/shell-gate.mjs")`，而 `toContain` 对**注释行**
  同样命中（同一段字面在注释里也出现）。§13.1 清单与钩子的双向对账
  （`scripts/check-doc-references.cjs`）也拦不住：它是两份手抄的互核，把两份**同时**抹掉
  就两边一致、全绿。
  - 实测的静默形态：注释掉那一步 + 清单里删掉 + `D(52)` → `D(51)` ⇒
    `node scripts/check-doc-references.cjs` **exit=0**、「文档引用与权威源一致」。
    而这一步是硬规则 5（改了壳必须重编）与 `src-tauri/src/**` 那批 `#[test]` 全仓
    **唯一**的执行者，静音它 = 回到「判据在文档里、没人跑」。
  - 与 #1371（`doc:check`）、#1404（R5 `--strict`）、#1451（注释语言棘轮）同族 ——
    `tests/doc-check-hook-wiring.test.ts` 已按 `ISSUE` 逐条钉住前三格，这是同一个洞里的第四格。

## Test

- **`tests/doc-check-hook-wiring.test.ts` 新增一组（`ISSUE #1597`）**：解析 D 组的
  `^ {2}run "<标签>" <命令>`（被 `# ` 注掉的不算在场），钉住①这一步真在跑
  `node scripts/shell-gate.mjs` ②§13.1「本地提交前必须通过」清单里有它
  ③脚本头那句「由 `.githooks/pre-commit` 的 D 组调用」不许消失。
  第二条单独存在的原因：对账的两份手抄不构成执行者，两份一起抹掉就一致了。
- **`tests/shell-gate.test.ts` 那条 `toContain` 改成同款解析式**：本仓库为「注释行也能命中
  `toContain`」已经踩过坑（该文件头与 `doc-check-hook-wiring` 文件头写着原因），只是没铺开。
- **变异核过**：注掉钩子里那一步 + 删清单 + 改计数 ⇒ `doc:check` 仍绿，而新判据红
  （两条断言分别点名「D 组 51 步里没有桌面壳门禁」与「§13.1 清单里没有」）；还原即绿
  （`doc-check-hook-wiring` 15 条、`shell-gate` 29 条全过）。
