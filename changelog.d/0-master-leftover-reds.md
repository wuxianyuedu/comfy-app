## Fixed

- **`tests/test-config-inheritance.test.ts` 在 Windows 上必红**（路径分隔符）。它比的是
  `vitest.config.ts` 里两个 project 的 `setupFiles` 是否等于字面量 `"tests/setup.ts"`，
  而 Vite 解析出来的绝对路径在 Windows 上是反斜杠（`tests\setup.ts`）。判据本身没错，
  错在拿「解析后的绝对路径」直接跟「正斜杠写法」比。改法是把两边都换算成**相对仓库根、
  正斜杠**再比 —— 与它守的那条「一处定义、两处消费」的语义无关，只是让这条判据在
  Windows 开发机上也能表达它原本要表达的东西。
  这条在 `FIXED_STRUCTURAL_TESTS` 里，所以它红着的时候**每一次提交**都被拦（硬闸类没有
  「带病通行」的中间态），是 Windows 侧提交的实际阻塞点。
- **页签选中态（#1558）漏录的那份 token 快照**：`tests/__snapshots__/theme-tokens.css-theme-surface.txt`
  补上这次新增的 `--gradient-brand`。它当时没被 pre-commit 拦下，是因为 C 组跑的是
  「固定清单 + 暂存改动沿**静态 import 图**追溯到的用例」，而改 `src/app/globals.css`
  不会把一份 `.test.ts` 的快照文件拉进图里 —— 于是这条红一路带进了 `master`。
  同批把快照更新，而不是等下一个改 `globals.css` 的人替它记账。
