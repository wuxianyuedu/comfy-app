## Changed

- **`stripP71AllowBlocks` 支持两种就地声明形态**（`scripts/check-ui-primitives.cjs`）：
  原本 regex 只认 `// p71-allow:start` 与 `// p71-allow:end` 前缀（`/\/\/\s*p71-allow:start\b/`）。
  这限制了 allow 只能落在 JS 表达式位（`{cond && (` 之后、return 里的 JS
  段等）；**JSX 兄弟节点位放不进**——`//` 会被 parse 成 JSX text、破解析。
  界面层最严格审计（`shadcn-strict-audit-2026-09-25.md` §2.1）里 5 处
  brand violet/fuchsia（ProjectOutputs 的封面渐变 / AgentOverlay 智能体头像
  渐变 / FilmStudio 底部 brand 渐变）**都在 JSX 顶层**、包不进 `//` allow，
  导致 P79 剩余里"brand 渐变与色板例外"这一大块无法就地声明、只能靠"迁
  移成不合适的语义 token"或"永远留在基线里"两条都不干净的路。

  现在放宽：`(?:\/\/|\/\*)\s*p71-allow:(start|end)\b` 同时命中 `//` 与
  JSX 注释起始 `/*`。JSX 位用 `{/* p71-allow:start … */}` 形态（JSX 注释
  标准写法）、JS 表达式位继续用 `//` 形态、两形态**在剥除阶段等价**。
  `p71-allow` 名字保留（P71 先立、P79 与之后可能的同族 palette 判据共用
  一份 allow，别另立 p79-allow 造成"一次标允许 · 二次标漏掉"的分裂）。

## Tests

差分回归 1 例：视图文件里既有一处 `{/* p71-allow:start … */}` 包住
`from-violet-500 to-fuchsia-500`（JSX 顶层位），又有一处 `// p71-allow:start …`
包住 `bg-red-500 text-emerald-700`（JS 表达式位），allow 之外两处
`bg-amber-500` / `bg-sky-500` 各计一次 → P79=2（4 处 allow 内的都被剥）。
