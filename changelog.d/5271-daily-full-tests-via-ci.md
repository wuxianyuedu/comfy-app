## Fixed

- 每日档全量单测红在 `tests/project-view-container.test.ts`（#5271）：脸库 / 服饰库 / 装饰库把文档容器收进
  `ResearchLibraryView` 共用后，判据仍挂在不再持有 `DocumentFrame` 的薄壳 `FaceLibrary.tsx` 上，
  得到「没抽出任何 className」的假红。清单改为判真正的容器宿主 `ResearchLibraryView.tsx`。
- 补规范 §11.28 与 `AGENTS.md` 同步条目：全量单测的执行者是 CI 每日档；本地只跑点名的受影响文件定性，
  提交推 CI 后从 `pnpm ship --diagnose` / `--gh-logs` 拿读数，不用本地整档绿当凭证。
