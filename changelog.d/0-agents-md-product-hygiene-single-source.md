## Changed

- **AGENTS.md 硬规则 17 / 18 收回「结论 + 判据 + 指针」，机制叙述只留一份出处**：这两条原本各
  内嵌一段构建链机制与 A/B 实测数字，而**同两段里各带着一条 ⚠️ 更正**（「Turbopack 不读这份键」
  那句旧机制表述是错的）—— 也就是说一次订正被迫改两处，而这正是本仓库最忌的「同一事实两处承载」。
  现在机制与实测数据只归 `docs/standards/launch-and-build.md` §7.2 第三件事之二 / §7.3 / §7.4，
  日志镜像那条独立通道归 07 §7.18.2.1；AGENTS.md 保留的红线一条没减：`next build` 无条件带进
  `.env` 与 `db.sqlite`、`outputFileTracingExcludes` 在这条链上不做减法、减法与数产物两件必须同批
  （递归按形状且不穿符号链接）、`pnpm build` 收尾的顺序（减法 → 数产物 → 冒烟）、两层顶层默认拒绝
  与「新增一项同改两处并写清谁在运行期读它」、缺件只由数产物判、产物要数两层，
  以及「ERROR 镜像不受 pino `redact` 保护、不许整包 `JSON.stringify` payload」。
  没有新增或放宽任何判据：`scripts/check-doc-references.cjs` 的 AGENTS ↔ standards 漂移守卫
  判的是复述的**路径 / 文件 / 章节锚点**与仓库状态是否脱钩，覆盖不到「机制被复述了一遍」，
  所以这一格此前只能靠人记得住两处同步（本文末「维护约定」的那句承诺）。
