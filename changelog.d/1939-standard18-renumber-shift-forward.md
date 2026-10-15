## Changed

- **`docs/standards/18-lib层规范.md` 的节号重编号：整体前移补上 §18.9，恢复单调、无缺号**
  （ISSUE #1939 / 上游 #1926）。此前 18 章的节号既乱序也缺号 ——
  出现顺序是 `18.1…18.8 → 18.10 → 18.11 → 18.13 → 18.14 → 18.15 → 18.12（速查排在最后）`：
  §18.9 根本不存在，§18.12 被排到文末、§18.13 又跳在 §18.12 之前，读文档的人按号找节会走空。
  - 采用「整体前移补 18.9」方案（#1939 待裁决口径的第 1 项）：
    `18.10→18.9`、`18.10.1/2→18.9.1/2`、`18.11→18.10`、`18.13→18.11`（含 `.1~.4`）、
    `18.14→18.12`、`18.15→18.13`，文末「速查」`18.12→18.14`。重编号后 18.1~18.14
    在文档里**单调递增、无重号、无缺号**。
  - **全库引用面同批改**（这是本条真正的代价，也是它从「整理文档」里单列出来的原因）：
    `AGENTS.md`（硬规则 11 / 24 与「强制先读」表）、`docs/standards/{12,16}`、
    `docs/superpowers/specs/**`，以及**源码注释** `src/lib/markdown/index.ts` /
    `src/server/auth/request-user.ts` / `src/server/lib/range-request.ts`、用例
    `tests/lib-server-imports.test.ts`、门槛配置 `vitest.config.ts`。
    一律按 `§` 前缀形态精确替换，未触碰任何裸号（如 §18.11.4 正文里 `lib/agent 18.9 → 78`
    那句**覆盖率百分比**，不是节号）。
  - `docs/generated/18-lib层规范.md` 由 `pnpm run doc:render` 重生成（**不手改产物**），
    `render-doc-placeholders.cjs --check` 同步。
  - 判据 `node scripts/check-doc-references.cjs`（AGENTS 的「文件 + §号双写」锚点定位）
    在重编号后仍绿 —— 它跟随的是目标文件里真实存在的标题锚点。
