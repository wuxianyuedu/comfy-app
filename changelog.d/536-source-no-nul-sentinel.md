## Fixed

- **源码里不再内嵌 NUL 字节，`markdown.ts` 的行内代码哨兵改成可打印形式（`<数字 id>`）**：`src/lib/comfyui/markdown.ts` 的 `renderInline` 用真的 NUL 字节把已渲染的 `<code>` 片段包成 `\0CODE<n>\0` 藏起来，好让后续几步正则「看不见」代码正文。代价是整个文件被 git / diff / grep / 多数编辑器判成**二进制**——`git diff` 只回一句「Binary files differ」（评审看不到改动）、`git show --stat` 显示 bin、`grep -rn` 静默跳过整个文件，而 CI 全绿。哨兵改用 `<数字 id>`：正文是先 `escapeHtml` 过的，用户写 `<0>` 到这一步是 `&lt;0&gt;`，撞不上恢复用的 `<(\d+)>`，隔离效果与 NUL 逐条相同，文件恢复纯文本。行为与输出 HTML 无变化。

- **`scripts/check-file-structure.cjs` 新增 R12：`src/**` 源码禁止内嵌控制字符，并接入 CI**（规范 §12.11）：按**码位**（而非按 `\0CODE` 这种字符串形状）扫描 `.ts` / `.tsx`，命中即阻断并点名 `文件:行 → U+00xx`；豁免只有制表符 / 换行 / 回车。判据写成形状的话，换一个哨兵就静默失效。门禁同时进 CI（`ci.yml` 的 `File structure rules` 步骤）——此前这套规则只在本地 pre-commit 跑，`--no-verify` 或未启用钩子的检出可以绕过。
