---
name: version-docs
description: 用 context7 MCP 查第三方库「本仓锁定的那个大版本」的官方文档与代码示例，治模型训练数据滞后导致的 API 幻觉。当要写 Next 16 / React 19 / drizzle 0.45 / tRPC 11 / better-auth 1.7 / Tauri 2 等新版本库的调用代码、或不确定某 API 在当前版本是否改名/废弃/换签名时使用；它只回答「这个版本的 API 长什么样」，不回答「本仓的判据是什么」。
---

# 第三方库「版本特定」文档检索（context7）

本仓库的依赖走在**很新的线**上（Next 16、React 19、drizzle 0.45、tRPC 11、
better-auth 1.7、Tauri 2）。这些大版本之间的 API 变动不少，而模型的训练数据大概率
**滞后**于它们 —— 于是最典型的失败形态是：代码写得很像对的、`tsc` 也许还能过，
但用的是**上一个版本**的用法（已改名的导出、已换成的 options 对象、已废弃的钩子）。

`context7` MCP 直接取官方文档源，按 **libraryId + 具体主题**返回**版本特定**的
文档与代码示例，注入上下文。声明见 `.mcp.json`（`pnpm dlx @upstash/context7-mcp`，只读）。

## 它治什么、不治什么（这条边界是本节存在的理由）

| 场景                                                     | 谁回答                                    |
| -------------------------------------------------------- | ----------------------------------------- |
| 「Next 16 的 `cacheComponents` 怎么配」                   | **context7**                              |
| 「React 19 这个 hook 还在不在 / 签名变了没」              | **context7**                              |
| 「drizzle 0.45 关系查询现在怎么写」                       | **context7**                              |
| 「远端 master 上别人升过依赖，我本地还是旧的」            | `pnpm check:deps-freshness`（**不是**它） |
| 「装了但某个包解析不到」                                  | `unresolvableDeclaredDeps()`（**不是**它）|
| 「本仓这条判据跑不跑 / 阈值多少 / 门禁在哪一步」          | `scripts/check-*.cjs` + `.githooks/pre-commit`（**不是**它）|

两句话记住：

1. **它治的是「库的 API 漂移」，不是「依赖的版本漂移」。** 后者本仓已有三层判据
   （`scripts/check-deps-freshness.mjs` ①②③ + 解析层探针，ISSUE #1569 / #1721，
   口径见 `docs/standards/13-提交与-code-review.md` §13.5.13）。不要拿它替代那些判据。
2. **它给的永远是「库的官方文档」，不是「本仓的约定」。** 本仓对新版本库有自己的
   钉死项与适配（例：`next.config.js` 的 `experimental.useTypeScriptCli: false`、
   `typescript` 走 `@typescript/typescript6` 别名、`src/lib` 的分层与 Node-only 声明）——
   这些**以本仓规范为准**，context7 查不到、也不该去查。看到官方文档与本仓规范
   冲突时，**以本仓规范为准**，并把冲突说清楚。

## 何时用

- 要调用某个**新版本库**的 API，而你不确定当前版本的确切形状 → 查。
- 遇到「按记忆写出来但类型/运行时报错」的第三方调用 → 先查再改，别急着猜。
- 升级某个库的大版本前，想先看 breaking changes → 查。

**不必用**：仓库内部的业务逻辑与判据（那些查 `docs/` 与 `scripts/`）、
纯类型层面的问题（直接 `pnpm typecheck` 更快且是判据）。

## 怎么用（两步，顺序不能反）

server 暴露两个工具（本机实测 `@4.3.0`）：

1. **`resolve-library-id`** —— 把包名/产品名解析成 Context7 的 libraryId。
   输入 `query`（这次想查什么，用于排序）。返回里带 `Code Snippets` 数量、
   `Source Reputation`、`Benchmark Score` 与**可用版本列表**。**除非你已经有
   形如 `/org/project` 或 `/org/project/version` 的 libraryId，否则必须先调它。**
2. **靠它返回的 libraryId 去查文档**（query-docs）。主题越具体越好：写
   「route handler 里读 cookies」，别写「怎么用」。

**版本对齐是本 Skill 的全部意义**：先看 `package.json` 里本仓锁的是哪个主版本，
再从 `resolve-library-id` 的版本列表里**选那一版**（libraryId 形态 `/org/project/version`）。
拿 `latest` 的文档去回答一个锁在旧主版本上的问题，等于把「训练数据滞后」换成
「文档超前」——同一种病换了方向。

## 校验 / 审批边界

- **只读**：这个 MCP 只做文档检索，不写文件、不执行变更；「据此改代码」仍走
  分支 + PR + pre-commit（AGENTS 硬规则 6、7）。
- **不作判据**：与本仓其它 MCP 同一条红线 —— **门禁判据只在 `scripts/check-*.cjs`
  与 `.githooks/pre-commit`**，MCP 输出不构成「这条判据过了」的依据。它最多帮你
  把代码**写对**，真正拦住你的是 `tsc` / `eslint` / `vitest` 与那份钩子。
- **网络依赖**：它是本仓三个 MCP 里唯一需要外网的（另两个 `codegraph` / `zvec-grep`
  是纯本地）。取不到文档时**如实说「没查到」**，不要凭记忆补一个看起来合理的答案 ——
  那正是本 Skill 要治的病。
- 代码检索与影响面分析（找定义 / 引用 / 爆炸半径）**不走这个 Skill**，走
  [`../code-navigation/SKILL.md`](../code-navigation/SKILL.md)。

## 安装与运行前提

- 不在 `package.json` / `pnpm-lock.yaml` 里：按需由 `pnpm dlx` 拉取（AGENTS 硬规则 1，
  只用 pnpm，不写 `npx`）。`.mcp.json` 里钉了版本（`@4.3.0`），升级时改那一处。
- 首次调用需要拉包，可能比本地两个 MCP 慢；无外网时工具缺席或报错，属预期。
