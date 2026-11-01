## Changed

- oxlint `unicorn/prefer-dom-node-append` 全仓清零：19 处 / 4 份（#2775）。
  `node.appendChild(x)` 统一改写为 `node.append(x)`，逐处核对过等价性 ——
  全部是独立语句、没有一处用到 `appendChild` 的返回值（`append` 返回 `undefined`），
  实参也都是 `Node`（没有传字符串的场景），插入位置与顺序不变。
  触发面集中在 e2e 的主题 token 探针与 `json-viewer` 的高亮拼装。
