## Changed

- **对外参数卡改成「一个口一颗点」**（用户口径：「提示词不是就应该有一个输出端口吗，每个候选落点一颗有什么意义」）：卡片只说这个口对外是什么（名字 + 类型），**落点由线的另一端声明** —— 拖这颗点连到宿主哪一行，这个口就落到哪一行；与尺寸卡「一行 = 一个形态，落点由另一端声明」同构。此前未连线时逐候选列行、每候选一颗点，那只在「尺寸」还是一个**聚合条目**时成立；尺寸摊成六个子口之后它只剩副作用（同一族的行重复列一遍，handle id 撞车）。
- **handle id 收敛成「条目 id」**：普通卡是契约口 id（`prompt` / `negative`），尺寸卡是子口 id（`size-aspect`）—— 一卡一颗点，条目 id 在同一画布节点内天然唯一。`parseLibraryHandle` 与 handle id 里的「落点段」一并删除，`onConnect` 拿到的 handle id 直接就是落库键。
- 未连线时卡片显示**这个口自己的类型**（按族：提示词 / 负向 = `STRING`，参考图 = `IMAGE`，时长 = `NUMBER`；尺寸子口按形态固定），不再显示 `*`；连上后显示落点那一行的类型。行上的 title 里仍可查落点（`ioKey`）。
- 随「一卡一点」退场的配套：候选圆点的 `reachableKeys` 收窄（preview → canvas → 卡片列 → `paramOutputPorts` 整条链）、`defaultOutputPortIndex`、`fallbackHandleId`、`parseLibraryHandle`。
- 回归用例：`一个口一颗点`（普通口与尺寸子口各一条）、未连线显示口自己的类型、有落点时类型与 ioKey 跟着落点走、`classPinType`、两卡各一颗点且锚点互不相同、`handle id 就是落库键`的那条链。
