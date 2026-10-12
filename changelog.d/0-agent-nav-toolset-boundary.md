## Changed

- **代码检索 MCP 的工具面收回到声明的只读边界，并把「空结果」变成可判定的状态**
  （`.mcp.json` + `.qoder/skills/code-navigation/SKILL.md` + AGENTS.md 的 code-navigation 条目）：
  `zvec-grep` 不再以 `--mcp-toolset full` 起 MCP 面，改用默认的 `agent` 档 —— 按该 server 自己的
  `--help`，`agent` 只给已建索引的检索，而 `full` 会额外暴露受管 rg / index / status。此前
  「这两个 MCP 只读、只做检索」这句话只写在 Skill 的正文里，配置开的却是更宽的一档：
  建索引这一步按同一份 Skill 的说法牵 embedding provider 与凭据，属于该由人敲的一次性动作，
  不该是常开面。需要 rg / index / status 时走 CLI（`zg query --rg` / `zg index` / `zg status`，
  help 明确这些仍走 daemon 的内部管理端点，与 MCP 面无关），口径同时写进 Skill 的「校验 /
  审批边界」。
- 同一条改动补上**就绪判据与一条红线**：这台检出上 `codegraph status` 报 `Not initialized`、
  `zg status` 报 `Workspace index is not configured`（Policy undecided），而**没建索引时语义查询
  返回空而不报错** —— 于是硬规则 24「动手写新逻辑前先查是不是已经有」的那一次检索，可能把
  「查不到」读成「仓库里没有」。现在 Skill 的「何时用」多一步先判就绪，AGENTS.md 保留红线：
  MCP 查不到不等于没有，要下「没有现成实现」的结论必须再用 Grep / Read 复核并说明用了哪一遍。
  没有为这条新增门禁判据：这两个 server 是每台开发机各自的全局工具（不在 `package.json` /
  lockfile 里，`pnpm install` 不带它们），把可选的导航加速做成提交拦路石会拦住所有没装它的机器。
