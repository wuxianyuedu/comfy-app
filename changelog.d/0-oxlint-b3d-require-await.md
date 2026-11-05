## Changed

- **B3 清账完成：最后 47 份 / 240（实测 242）处 `typescript/require-await` 清零**。
  判决面里 B3 的整个文件级豁免块已删除（`typescript/require-await` 规则本体仍是 `error`），
  台账 B3 行改「已清（754 处 / 188 份，子批1–4）」。
- 连带修复同前几批：测试替身与桩工厂按 `Promise.resolve(...)` 保住 Promise 契约（约 107 处），
  并恢复 `importMaster` / `runMasterMirror` 等入参的上下文类型（消除 2 处 `no-unsafe-call` / `no-unsafe-member-access`）。
- 清账总账：#3181（本批挂 `Refs`）。
