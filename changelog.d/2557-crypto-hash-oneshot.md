## Changed

- **单次哈希三步式换 `crypto.hash()` 一步式**（ISSUE #2557，Node 21.7+ 稳定、引擎已钉
  26.12.1）：11 处 `.createHash(algo).update(x).digest(enc)` 单链换成 `crypto.hash(algo, x, enc)`
  （check-bundle-budget / ci-image-plan / db-schema-state / eslint-cache-fingerprint /
  tauri-tools-cache / worktree / app-settings / importSource / secrets /
  workflow-local-roots）；多余的 `createHash` import 随之清理。
- **不换的四处**：`ci-build-cache-slot` / `ci-deps-face` ×2 / `worktree` 的 combined /
  `localWorkflows` 的流式 —— 多次 update 与流式读不在一步式的语义内。
- 等价性自证：hex 字符串与字节两种消费形都逐字节比对一致（含 db-schema-state 的
  `readUInt32BE(0) & 0x7fffffff` u32 位形）。
