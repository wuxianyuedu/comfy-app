## Fixed

- **`next dev` 不再改仓库根的 `AGENTS.md`**（ISSUE #3669）。Next 16 的
  `agentRules` 默认开启：每次开发服务器启动都会往 `AGENTS.md` 末尾追加一段
  `nextjs-agent-rules`（给 AI 代理看的 Next 版本提示），而本仓的 `AGENTS.md`
  是入库的协作规范、master 上没有这一块 ⇒ 每跑一次 dev 就多一处与工作无关的
  稳定脏改动，`pnpm ship` 的「工作树干净」检查会被它绊住。已在 `next.config.js`
  设 `agentRules: false` 明确关闭；规范 §9.1 同批补了一句辨识口径（看到
  `M AGENTS.md` 且 diff 是这一段 = 旧检出的残留，还原即可）。
