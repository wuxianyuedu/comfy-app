## Changed

- **自研 markdown 渲染器整块迁到 `marked` + `DOMPurify`**（ISSUE #1329）：`src/lib/comfyui/markdown.ts`（384 行、手写「HTML 转义 → 标签拼装 → `href` scheme 白名单」）删除，换成新域 **`src/lib/markdown/`**——`marked` 解析 + DOMPurify 消毒 + 本仓库样式表。三个消费点（工作流节点便签、剧本预览、工坊剧本区）零改动，导入路径从 `~/lib/comfyui/markdown` 改为 `~/lib/markdown`。
  - **为什么换**：这是一条安全敏感边界（输出直进 `dangerouslySetInnerHTML`），自研白名单每加一种语法就多一处要重新论证「这次转义是否完整」的表面积；换过去等于把这块风险外包给被反复审计的组合。顺带拿回文件头当时自己声明「不在范围内」的那批能力。
  - **域为什么独立**：渲染的是「一段用户文本变成 DOM 片段」这件事，与 ComfyUI 编排无关。历史上它落在 `comfyui/` 只是因为第一个消费方是 ComfyUI 便签，于是第二个、第三个消费方每次取用它都要反向依赖 ComfyUI 域。新域按 §12.5.3 R14 登记 `DOMAINS`，并按 §18.6 设实测值覆盖率门槛（95/90/100/95）。
  - **白名单是本仓库的那一份，不是 DOMPurify 的默认口径**：基表取 `USE_PROFILES: { html: true }`（收回 SVG / MathML / `template` 这些历史绕过面）、`FORBID_TAGS` 收表单类（钓鱼面；`<input>` 保留给 GFM 任务列表）、`FORBID_ATTR` 收 `style`（`position:fixed` 能盖住整个应用、`background:url(…)` 能渲染时外带）。
  - **补了 DOMPurify 默认口径的一处缺口**：它拦 `href` 上的 `data:` 但**放行 `src` 上的 `data:`**，而 `data:image/svg+xml,…` 里的 SVG 可以带脚本 —— 于是「markdown 里的图片」是一条执行通道。新域加了一层 URL 协议白名单（`http(s)` / `mailto` / `tel` / 相对路径 / 锚点），钩子挂在剪枝之后，`java\tscript:` 这类转义绕过同样被剥。
  - **样式与安全拆成两个文件**：`styles.ts` 只放形状、`sanitize-config.ts` 只放边界。安全白名单刻意禁掉用户内容的 `style`，而本仓库自己要的那批样式由渲染**之后**的一步注入 —— 顺序反了不会报错，只会让渲染出来的东西悄悄没有样式。

## Tests

- `src/lib/markdown/render.test.ts`：迁移前的单测**逐条搬过来**并保持断言口径（语法点、XSS 边界、行内代码隔离语义），另立一组「与迁移前的刻意差异」显式登记行为变化（图片、有序列表、嵌套子列表、任务列表、未闭合围栏 —— 这些都是旧实现「先整串转义」的转义副产品，文件头当时列为不在范围内）。
- `src/lib/markdown/html.test.ts`：直接打消毒那一步（不经过 markdown 解析，因为它的成立不能依赖上游先转义过），并**按 `FORBIDDEN_TAGS` / `FORBIDDEN_ATTRS` 清单本身遍历**核每一条真的生效（清单里拼错一条 tag 就是一条静默失效的豁免）；另覆盖「无 DOM 宿主」的可读错误出口。

## Chore

- `scripts/check-inline-style.cjs` 删掉指向已删文件的死豁免（`src/lib/comfyui/markdown.ts`）——一个指向不存在路径的豁免不是豁免，是「下一个人往这个路径写东西时被静默放行」。
- `scripts/.non-null-assertions-baseline.json` 随文件删除收紧（193 → 169）。
- 文档同步：规范 03 §3.6.1 的 token 表、规范 12 §12.11 的哨兵实例（该模块已不再需要哨兵）、`globals.css` 的 `--color-md-*` 出处注释。
