## Added

- **`ui/` 本地改动台账 +「标记 ⟺ 台账」门禁**（规范 16 §16.8）。`src/components/ui/**` 是 shadcn 的工具生成目录（§16.7 要求不手工编辑），但本仓库在 8 个基元上**有意**做过改动：`button` 的 9 个语义色变体与 `ButtonLink`、`dialog` 的 backdrop 收敛（`dialogBackdropClass()`）与 `popupClassName`、`sheet` 的同款遮罩收敛、`alert` 的 4 个语义色变体、以及 `select`/`popover`/`dropdown-menu`/`tooltip` 的层级刻度档。此前**没有任何地方**记着这些文件不能被覆盖 —— 实测 `shadcn add command` 会顺手覆盖 `button` / `input` / `textarea` / `dialog` 四个文件（其中 `button` 被冲掉会让全库 40 多个文件的 `variant="danger"` 一类调用编译不过，`dialog` 被冲掉会让浮层不再让出标题行、`check-title-bar-clearance` 当场红），并引入新依赖 `cmdk`。

  现在三件事配套：① 这 8 个文件的头部带一行 `ui-customized:` 标记（`"use client"` 文件放在指令行之后）；② `docs/standards/16 §16.8` 逐个登记「定制是什么 / 为什么 / 覆盖后怎么补」，并写明覆盖前的三步动作（`--dry-run` 看会不会命中 → `--diff` 看差异 → 命中就别直接 add）；③ 新增 `scripts/check-ui-customizations.cjs` 把两侧的一致性机器化（零网络，双向差集，已挂 pre-commit 第 30 步），拦住「标记了没登记」与「登记了没标记」两种脱节，`--report` 可盘点。

## Changed

- **`ui/` 之外的文件不受影响**：与官方版只在 import 别名（`~/lib/utils` 那层 `cn` 间接）、class 串顺序、注释中文化上有差异的基元（`accordion` / `avatar` / `badge` / `card` / `input` / `label` / `progress` / `scroll-area` / `separator` / `skeleton` / `slider` / `sonner` / `switch` / `tabs` / `textarea`）**不登记、不带标记** —— 覆盖它们不丢行为，可以继续当官方原版用；这条口径写在 §16.8 里，避免门禁退化成「二十多个文件都要登记」的噪音源。
