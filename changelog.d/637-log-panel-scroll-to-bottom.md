## Fixed

- **应用日志滚不到底：滚到底看最新会被下一轮轮询按回顶部**。贴底（`autoScroll`）的判据只认「基线水位」，而基线在面板打开时是 0，并且 `onScroll` 只在 `!autoScroll` 时才重取基线——面板打开时 `autoScroll` 已是 `true`，于是「从顶部滚到底部」这条最常见的路径永远重取不到基线，下一轮轮询的贴底 effect 又把 `scrollTop` 算回第 0 行，用户被按回顶部、看不到最新一行。现在两层兜住：`onScroll` 的基线判据**只看是不是贴着底**（贴着底 = 要看最新，基线取末条），贴底 effect 在「用户已把 `scrollTop` 滚到别处」时**不再覆盖**他的位置（只负责新日志到达时钉住已读水位）。位置算术（目标行序号 / 贴住底边的 `scrollTop` / 该不该动）抽进 `log-virtual.ts` 的 `pinTargetIndex`、`pinScrollTop`、`pinPlan` 并补单测；回归由 `e2e/critical-flows.spec.ts` 的「满页 2000 行…滚得到最后一行」兜住（此前长期红）。规范 07 §7.28.5 记下这个现场与夹具的坑（mock 路由每轮重算时刻会让去重失效、时间线净增）。
