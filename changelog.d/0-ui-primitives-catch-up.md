## Added

- **补齐官方 shadcn 基元库（17 个）**：`src/components/ui/` 此前 57 个基元，官网 registry 里还缺一批基础件，后续 UI 工作（菜单栏、面包屑、快捷键帮助、表格、右键菜单…）要用。本次引入：`checkbox`、`radio-group`、`toggle`、`toggle-group`、`context-menu`、`hover-card`、`breadcrumb`、`kbd`、`pagination`、`table`、`aspect-ratio`、`menubar`、`navigation-menu`、`native-select`、`item`、`button-group`、`input-group` —— 全部为 **base-ui 版**（`base-nova`），**零新依赖**。

  引入流程（按 §16.8 的"覆盖前必读"走，两条实测坑）：

  1. `shadcn add` 的**依赖链会顺手覆盖既有文件**：这 17 个会带出 `button` / `dropdown-menu` / `separator` / `input` / `textarea` 五个（其中 `button` / `dropdown-menu` 是 §16.8 台账里的定制件）。做法是让 CLI 写新文件，被覆盖的既有文件**全部用 git 还原**（`git checkout --`）。
  2. CLI 的"文件已存在，是否覆盖？"确认在**非交互环境下会挂住**（`-y` 不覆盖这一问；stdin 喂 `y` 也只在第一条生效）。剩余的 6 个（`toggle-group` / `pagination` / `menubar` / `item` / `button-group` / `input-group`）改用 `shadcn add <item> --view <path>` 取**原始内容**落盘，并校验 CLI 自报的行数（行数不符即不写入）。
  3. 落盘后按仓库口径归一：`cn` 来源统一为 `~/lib/utils`（该文件就是 `export { cn } from "cn"` 的一行间接层，属 §16.8 的"仅别名差异"档，不登记），并按仓库 prettier 配置重排。

- **三处官方写法按本仓库判据改造**：① `native-select` 与 `input-group` 里的 `Omit<React.ComponentProps<…>, "size">` 被 UI 基元门禁 **P57（自写 props 剔除表）** 拦下，改为走 `~/lib/dom-props` 的 `OmitOwnProps`（类型层面等价）；② `toggle-group` 里 4 处 `context.variant || variant` 被 eslint 的 `prefer-nullish-coalescing` 拦下，改为 `??`（上下文默认值是 `"default"`，两侧都不可能为空串，等价）。这三个文件因此相对官方版有实质改动 —— 待 §16.8 台账机制（PR #885）合并后需登记进台账并加 `ui-customized` 标记。

- **补齐官方 shadcn 基元第二批（3 个，带 2 个新依赖）**：`command`（命令面板）、`combobox`、`resizable`。这三个的官方实现要用到包，故顺带引入两个依赖（`package.json` + `pnpm-lock.yaml`，没有任何 `allowBuilds` 变更 —— 两者都没有 postinstall）：

  | 依赖                      | 版本      | 用途                         | 传递树                                                                                                                                                                                                                |
  | ------------------------- | --------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `cmdk`                    | `^1.1.1`  | `command` 的搜索与键盘导航内核 | 8 个低层基础包：`react-remove-scroll` / `react-remove-scroll-bar` / `react-style-singleton` / `use-callback-ref` / `use-sidecar` / `aria-hidden` / `detect-node-es` / `get-nonce`。**不含 `@radix-ui/*` 本体**（锁文件 diff 实测只有上述基础包），与 §16.1「不要混用 radix 版 shadcn 组件」不冲突 |
  | `react-resizable-panels`  | `^4.13.2` | `resizable` 的分栏拖拽内核     | 无                                                                                                                                                                                                                    |

  引入流程与第一批相同（`--view` 取官方原始内容 + 行数校验），依赖链带出的 5 个 overwrite（`button` / `input` / `textarea` / `dialog` / `input-group`，其中三个是 §16.8 台账里的定制件）**一个都没被覆盖**。

- **`command` 的两处本地化改造**：① `Omit<React.ComponentProps<typeof Dialog>, "children">` 被 UI 基元门禁 **P57（自写 props 剔除表）** 拦下 → 改走 `~/lib/dom-props` 的 `OmitOwnProps`（类型层面等价）；② `CommandDialog` 的默认标题与描述原本是英文（`Command Palette` / `Search for a command to run...`），改为中文（`命令面板` / `搜索要执行的命令…`）—— 应用界面是中文，默认文案不该漏出英文。该文件因此相对官方版有实质改动 —— 待 §16.8 台账机制（PR #885）合并后与本批其余文件一并登记并加 `ui-customized` 标记。

## Fixed

- **`tests/ui-primitives-coverage.test.ts` 的单条用例超时**：它 60+ 个 case 每个都重走一遍 `src/**` 并重读每个文件，基元一多就擦着 vitest 默认的 5s 超时（实测出现过一次「Test timed out」的 flake，重跑即过 —— 是成本问题，不是判据问题）。改为只取一次「路径 + 内容」快照，判据一字未改。
