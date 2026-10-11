## Changed

- **`tools/` 下看不出用途的名字改为自述名（去掉简称）**（ISSUE #1738）：此前
  `tools/` 里几个顶层名字只给一个泛词 —— `studio` 不说是数据库工具、`registry`
  不说是哪家的 registry、`mcp-http.ts` / `mcp-stdio.ts` 里 `mcp` 是缩写，
  光看名字看不出「它是做什么的」。现按「名字自己说清楚」改名：

  | 原名 | 新名 |
  |---|---|
  | `tools/studio/` | `tools/database-studio/` |
  | `tools/studio/start-studio.ps1` | `tools/database-studio/start-database-studio.ps1` |
  | `tools/studio/start-studio.logic.ps1` | `tools/database-studio/start-database-studio.logic.ps1` |
  | `tools/registry/` | `tools/shadcn-registry/` |
  | `tools/registry/start-registry.ps1` | `tools/shadcn-registry/start-shadcn-registry.ps1` |
  | `tools/scripts/start-registry.ps1` | `tools/scripts/start-shadcn-registry.ps1` |
  | `tools/mcp-http.ts` | `tools/workshop-mcp-http.ts` |
  | `tools/mcp-stdio.ts` | `tools/workshop-mcp-stdio.ts` |

  入口与逻辑仍「同名不同层」（`start-shadcn-registry.ps1` 两侧同名、
  `start-database-studio.logic.ps1` 用后缀区分），改名只是把名字写全，
  不改变结构约定（规范 §8.6）。

## Docs

- 全部引用同批跟上：`README.md`、`tools/README.md`、`tools/{database-studio,shadcn-registry}/README.md`、
  `tools/scripts/README.md`、规范 §8.2 / §8.6 / §9（`launch-and-build.md`）、§16（shadcn）、
  `docs/workshop-mcp.md`、`docs/reference-facts.md`、`AGENTS.md` 硬规则 12，以及两处按名读文件的
  脚本（`scripts/doc-facts.cjs` 的端口权威源、`scripts/check-file-structure.cjs` 与
  `scripts/check-ps1-consistency.mjs` 的注释）。`docs/generated/**` 随 `pnpm run doc:gen` 重生成。
- `package.json` 的 `mcp:stdio` / `mcp:http` 两条脚本指向新路径（命令名不变，
  MCP 客户端配置无需改动）。

## Tests

- `tests/ps1-consistency.test.ts` 的「两份清单都不收某个入口」与「表里列了逻辑脚本」
  两条用例引用的路径同批改名 —— 它们钉的是真仓库里的入口清单，改名后必须跟着走，
  否则这两条会对着一个不存在的文件做变异（变异不生效、用例反而假绿）。
