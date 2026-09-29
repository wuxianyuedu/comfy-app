## Fixed

- **`docs/guides/TESTING.md` 与仓库现实脱节到会把人带偏，按实测重写**（体检清单第 ⑤ 条）。
  它停在 2026-09-04 的状态，几处关键事实已经反了：
  ① 「当前覆盖（231 用例 / 17 文件）」外加一张 16 行的文件表 —— 实测是 **468 个文件 /
  五千九百多条用例**，那张表既不全也不会被核对，读者据此判断「哪里没测」比不判断更糟。
  整张删掉，换成「怎么数」的命令 + 一次带 commit 的快照（清单类内容每次提交都会烂一行）。
  ② 覆盖率表只列了 `src/server/api/middleware/**` 一行 —— 实际是 `coverage.include` 62 项、
  `thresholds` 82 条。补上三条口径（按实测向下取整到 5 的倍数 / 只升不降且下降要写旧值 /
  新增 `ui/` 出口必须 `include` 与 `thresholds` **两处同改**，否则门槛静默失效）与判定档位
  （只在全量档判；`reportOnFailure` 防「一条红 → 报告不产出 → 门槛静默缺席」）。
  ③ 路线图里挂着三条**早就做完**的事：「tRPC router 集成测试（需 db mock 方案）」
  （`tests/helpers/test-db.ts` 走内存 SQLite + 真 Drizzle）、「Playwright 关键 E2E」
  （29 条 `@critical`）、「ReactFlow Provider 包装方案」（`tests/helpers/react-flow.tsx`）——
  挂着就会有人去补已经存在的东西。
- **新增「已知边界（当前真实状态）」一节，分成「有自动化」与「没有自动化」两栏**：
  平台侧没有兜底（#623 之后只剩本地钩子，`--no-verify` 可绕）、E2E 与视觉是手动档、
  Rust 壳的 `#[test]` 不进门禁、`src/app` 页面层基本裸奔、4 份 `.snap` 结构快照待迁
  —— 这些此前散在规范与台账里，指南只字不提，读者以为都已闭环。细节仍指回
  `docs/guides/PRODUCTION-GAPS.md`，本文件不复写数字（会漂移的那类）。
- 补两条日常会踩的口径：**别默认用 `--no-file-parallelism` 跑全量**（串行 2~3 小时，它的
  正确用途是给一条红定性，见 §11.13）；跑 E2E 前先 `pnpm db:push`（`pnpm build` 只证明
  「没有库也能构建」）。
