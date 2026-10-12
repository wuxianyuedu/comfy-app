## Changed

- **`shadcn` 从 `dependencies` 挪到 `devDependencies`（ISSUE #1803）**：它是个 CLI，
  `src` 里零处 import，生成产物直接进 `src/components/ui/**`，按用途归属开发期依赖
  （与 `drizzle-kit` / `typedoc` 同族）。**收益是语义准确而不是体积** —— 本仓打包时
  两类依赖不做区分（`build-desktop.mjs` 整树解引用拷贝 `next/standalone`），
  挪它不省分发体积，口径见 [16 §16.1.1](docs/standards/16-shadcn-ui与表单校验.md)。
