## Fixed

- **`pnpm ship` 的临时文件不回收 —— 提交信息原样留在 `.workbuddy/` 里**
  （`scripts/ship.mjs`）。写提交信息与 PR 正文用的是 `writeTmp`，落在 `.workbuddy/`
  （gitignored，所以漏删**不会进历史**、只会一直堆着）。实测前几轮真跑之后那里留了
  **3 份** `ship-commit-msg-*.tmp`，内容是当场拼的提交信息原文。
  当场拼的东西留在盘上没有用处，而提交信息里常带读数与现场描述，算半个卫生问题。
- **清理做成结构性保证，不是「用完顺手删一句」**。选形状的理由是这里恰好有一条
  提前 return：钩子**拦下**提交时 `return finish(codes)` 就发生在写完临时文件**之后**
  （`scripts/ship.mjs` 提交那一段），所以在调用点后面补 `unlinkSync` 照样漏 ——
  而漏的正是没人回头看的那几次（本仓这一族事故反复出现的就是「失败路径没被走第二遍」）。
  落法：`main()` 建一个回收清单 → 传给 `runFlow` → 两个写盘点统一走 `mkTmp()`
  登记 → `main()` 在 `finally` 里逐个 `unlinkSync`（删失败**不改变**这一次编排的结论，
  所以那里 `catch {}` 是刻意的，不是吞异常）。`writeTmp` 现在只有 `mkTmp` 一个调用者
  —— 没有第二条写盘出口，也就没有「新加一处忘了登记」。
- **用例打在会漏的那条路径上**：`commitStatus: 1`（钩子拦下）+ 一份真提交信息，
  跑完断言 `<root>/.workbuddy/` 存在但**为空**。带一条前置断言 ——
  那个目录确实被建过；否则「没残留」只是因为压根没写过，那条判据就是空转的。

## 验证

- `tsc --noEmit` 0 错、`eslint` 0 警、注释语言硬闸过、`check-infra-file-size` OK。
- `tests/ship.test.ts` **34 passed**（新增 1 条：临时文件回收 + 前置断言）。
- 手工核过：清掉本会话真跑留下的 3 份 `.tmp` 之后，`.workbuddy/` 里只剩
  非本次创建的既有文件（`patch-*.py` / `memory`），未动。
