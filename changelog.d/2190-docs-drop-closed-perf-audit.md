## Removed

- **删掉 `docs/audits/2026-09-26-performance.md`（61 行）** —— 按 `docs/README.md` §7.3
  「全部闭环 → 直接从 `docs/audits/` 删除该文件」执行。删除前复算的两件事：
  ① 状态标记：`grep -c "⬜\|📝\|✅\|待整改"` 回 **0**（既没有未处理项，也没有在册例外）；
  ② 入链：`git grep` 除自身外**零命中** —— 唯一提到这个文件名的是
  `changelog.d/0-docs-stale-claims-batch1.md` 里那句**描述复量方法**的历史记录
  （它说的是「用 `grep -c ⬜` 逐份数状态标记」这个手法，不是指向这份文件的链接），
  其余命中都属于同日另一份 `2026-09-26-performance-audit.md`（那是仍在跟踪的台账，本批保留）。
- 同目录同日那份 `-audit.md` **没有一起删**：它 §C 的七条此刻是「已转 Issue 跟踪」态，
  删除条件确实已满足，但 §A 的「条目 ↔ PR」对应表与 §B 的判定修正仍是引用对象 ——
  `docs/standards/02-性能规范.md` 引它取 F1 / F2a / F2b / F3 的闭环结论，
  `docs/audits/2026-10-12-architecture-risk-review.md` 开头声明「不含本文件已闭环的微性能项」。
  这一句留在台账 §C 开头，下次要删时先处理那两条引用。
