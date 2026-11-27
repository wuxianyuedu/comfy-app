## Fixed

- `check-docs-api.cjs` 的「产物可移植」判据改成有边界的路径匹配，短 root 检出不再误报（#5163）。原先用裸 root 做 `text.includes()`：容器 root `/workspace` 恰好是 `app/workspace/page.tsx` 的子串，即使 typedoc 0 warning、产物没有任何本机绝对路径烤入也判红。现在只有 root 后紧跟路径分隔符（`/` 或 `\`）、或 root 作为独立 token 出现在空白/引号/HTML 定界符/结尾时才算泄漏；`x/workspace/src`、`/workspace-extra/x` 这类「root 只是子串」的相对路径片段一律放过。root 的三种分隔符形态（原样 / 全 `/` / 全 `\`）都收，正则元字符按字面量匹配。同批补短 root 的负控、真泄漏正控（含 Windows 反斜杠形态）与元字符用例。
