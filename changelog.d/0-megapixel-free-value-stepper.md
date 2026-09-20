## Added

- **尺寸的「百万像素」可以填任意值（档位之外加了带加减号的步进器）**：「百万像素」在端口上本来就是 FLOAT（连续量），此前界面只给 1M / 2M / 4M 三档，想要 2.5 这个值只能去改工作流 JSON。现在「像素」一栏的「百万像素」分组下多一条「自定义」步进器（`−` / 值 / `+`，步进 0.1M，上限按尺寸上界反推 ≈16.8M），可以直接给出任意值。工坊的尺寸选择器与工作流表单的尺寸控件共用同一个实现（`MegapixelStepper`）—— 不会出现「这里能填 2.5、那里只能填 2」。
- 值的写法统一为 `<数值>M`（与档位标签同形，`megapixelLabel` / `parseMegapixelLabel` 互逆）：于是「自由值」在存储上与档位是**同一种东西** —— 换算（`sizeSpecDims`）、摘要（`sizeSpecSummary`）、远端下发（`sizeSpecToRelay`）都不需要多认一种形状。
- `size-presets` 新增 `parseMegapixelLabel` / `isClarityLabel` / `megapixelLabel`；`clarityPresetOfLabel` / `megapixelTierOfLabel` / `clarityKindOfLabel` 一并认自由值，`normalizeSizeSpec` 不再把 `"2.5M"` 回退成 `"1k"`（此前会静默按 1M 算）。
- `ui/segment-popover` 的分组新增可选 `extra` 插槽：给「不是从几个选项里挑一个、而是直接给一个值」的连续量控件留位置（弹层里挨着它自己那一组渲染）。

## Fixed

- 工作流表单的尺寸控件，「像素」的显示名此前取「距离最近的档位」：自由值 2.5M 会被 16:9 的 2k 档（换算出来 2.359M）吸走名字，触发器显示成「2k」—— 用户看着像「我填的 2.5 没了」。现在必须**精确**命中档位才用档位名，命不中就按自由值显示（`2.5M`）。
