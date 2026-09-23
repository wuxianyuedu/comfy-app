## Fixed

- **工作流带 rgthree 批注节点时「工作流校验未通过」整单失败**：`Bookmark (rgthree)` / `Label (rgthree)`（`Reroute (rgthree)` 同理）是**只有前端实现**的虚拟节点，服务端 `object_info` 里没有；comfy-cli 的 UI→API 转换会保留它们并对照服务端校验，于是报 `class_type 'Bookmark (rgthree)' not found in object_info` 而**整单失败**——服务端本来会按「不可达」把它们剪掉（同一条 envelope 的 warnings 里就是 `node_not_reachable_from_output`）。

  原先的剔除名单只有 Fast Groups 三件套，**且只扫顶层 `nodes`**：子图（`definitions.subgraphs`）里的批注节点（现场 `1512:1675` / `1512:1728`）因此漏网。现补齐名单，并把剔除逻辑抽到 `src/lib/comfyui/raw-ui-only-nodes.ts`、**同时扫 `definitions.subgraphs[*]`**（对象 / 数组两种定义形态、六元组 / 对象两种 links 形态），配套单测 `raw-ui-only-nodes.test.ts` 钉住名单与两种形态。

  **范围说明**：本条只处理「服务端不认识的纯 UI 节点」这一类校验错误；同一份 envelope 里若还有 `shape_mismatch`（如 `shift: expected FLOAT, got bool`、`steps_total: expected INT, got str 'euler'`、`clip_name: 5 not in 20 known options`），那是 comfy-cli 自身 UI→API 的控件值错位，不在本条范围内，需另行处理。
