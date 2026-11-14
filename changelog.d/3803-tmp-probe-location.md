## Changed

- **规范：临时诊断探针默认落 `.workbuddy/`（普通 Node 脚本，不在 lint 扫描面与 vitest 收集面）；确需 vitest 能力的进 `tests/__tmp-*.test.ts` 且跑完当场删（#3803）**——`oxlint --deny-warnings` 连未跟踪文件一起扫，残留探针顺手贴的 disable 指令会被判死豁免报警，卡死全仓 lint 与 pre-push 的 `check:premerge`。口径见规范 §13.5.42 与 AGENTS 快速排障；按单子期望先立口径、不新写自动扫描判据。
