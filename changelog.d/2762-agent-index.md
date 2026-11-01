## Added

- **`pnpm agent:index`：两个代码索引工具（codegraph / zvec-grep）的就绪读数入口**（ISSUE #2762）。
  `.mcp.json` 声明了这两个本地 MCP，但索引是每台机器各自的缓存：没建索引时语义查询
  **返回空而不报错**，于是「查不到」会被读成「仓库里没有现成实现」——而硬规则 24 的复用优先
  正靠这个结论下判断。新入口只做一件事：把两个工具**自己的读数**交出来（能不能用、索引了多少
  文件、上次建是什么时候）。status 来源不另立判定——codegraph 取 `codegraph status -j` 的
  `initialized`（**未建索引时它也退 0**，拿退出码当结论会假绿），zvec-grep 取
  `zg status --check-ready` 的退出码，两者的输出都原样转发（不吞 stderr）。默认**只读**，
  `--init` 才建索引（只对明确报「没就绪」的工具动手，随后重新取一遍状态；zvec-grep 的
  embedding provider 仍由人决定）。三态：`0` 两个工具都报就绪、`1` 有工具明确报没就绪、
  `2` 没取到读数（工具不在 / 输出解析不了——这一档不是绿）。索引目录 `.codegraph/`、
  `.zvec-grep/` 同批登记进 `.qoderignore` 的排除面（`.gitignore` 早已有），不再被索引一遍。
  判据在 `tests/agent-index.test.ts`（13 条：读数来源 / 缺席形状 / 合成口径 / 入口三态）。
