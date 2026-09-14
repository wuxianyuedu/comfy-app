## Fixed

- **浮层强调 chip 借用了「节点强调底」token，浅色下底与字同时变浅（ISSUE #75 清单 D 类）**：`WorkflowSourceFilterChip` / `WorkflowNode` 的强调 chip 用的是 `bg-node-accent`——它是**节点**表面 token（浅色 `#f2eeff`），套到页面级浮层上以后，浅色下底只是略深的浅紫，而 chip 内的文字是写死的亮色（`#A78BFA` / `#33D499` / `text-cyan-200`），对比度掉到 1.3~1.6，基本看不见。新增语义 token `--color-overlay-accent-surface`（浅色 `#f1edff` / 深色 `#241f38`）专门承载浮层强调底，并给 chip 文字补浅色档（`text-violet-700` / `text-emerald-700` / `text-cyan-700` + `dark:` 侧保留原亮色）。

## Changed

- **固定暗色清单新增「类型色例外」条款（ISSUE #75）**：明确端口类型色 / 节点类别色 / 参数分组色这类**成组集中的常量表**（`lib/comfyui/types.ts`、`config/custom-nodes.ts`、`CanvasNodePrimitives.tsx` 的 `PORT_STYLE`、`WorkflowPortHandle.tsx`、`canvas-types.ts` 等，约 320 处）**允许保留写死色值**，并给出三条理由（它们表达的是内容自身的语义 id，不是结构性表面；换成浅色档会与浅色内容糊在一起；逐个 token 化会让 32 个端口类型变成 32 个 token 反而难维护）与边界（组件的**表面/文字**语义色值仍必须 token 化）。`globals.css` 清单与 `docs/standards/03-样式与-tailwind.md` §3.6.1 两处同步，防止后续扫描再把它们当漏网改一遍。
