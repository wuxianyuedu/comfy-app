# AI 短片五步工作流（通用模板）

> 这是**可照抄的空白模板**，与具体剧集无关。填好的实例见
> [《出端之刃》制作 playbook](production-playbook-chuduan-zhi-ren.md)。
> 方法论来源：《别再抽卡了：顶级AI短片的5步工作流》（https://mp.weixin.qq.com/s/MM-grkCy6SbSyPYkLH6kmg）
> 对三个电影节入围项目的工程拆解；本模板只保留映射进本仓库能力的部分。

## 0. 总原则

生成次数多不等于乱抽卡。**先建资产库 → 立视觉圣经 → 像拍电影一样写每个镜头 → 上一镜交给下一镜**。
本仓库已有对应地基，不需要新造一套：

| 五步 | 仓库落点 | 新项目要做什么 |
| --- | --- | --- |
| ① 资产库 | `character` / `seriesAsset` / `episodeAsset` / `asset` 表与 tRPC（`series-character`、`series-assets`、`asset`） | 建系列实体，把角色 / 场景 / 道具 / 参考图录进去 |
| ② 视觉圣经 | `seriesAsset(kind="style").data`；`film.create` 的 `visualBible` / `negativeExtra` | 填下面 §2 的清单，建片时作为参数传 |
| ③ 结构化镜头提示词 | `filmShot.prompt` / `negative` / `params.dialogue`；`prompt-builder.ts` 的风格插槽 | 按 §3 十段模板写每镜 |
| ④ 连续性接力 | `Shot.continuityFromShotId` → `filmShot.params.tailFrameFrom` → `tail-frame.ts` 抽尾帧 | 按需逐镜启用（默认关闭） |
| ⑤ 废片留档 | `generated/` 产物树 + `asset` 表 | 不删失败 / 废片，按次留档复盘 |

## 1. 资产库（先建，后拍）

资产只生成一次，之后每镜从库里调用。目录 / 表对应：

| 资产类 | 库位置 | 登记方式 |
| --- | --- | --- |
| 角色（三视图 / 面部特写 / 每套造型） | `character` 表：`appearance` / `costume` / `styleTags` / `portraitUrl` / `portraits` | 系列角色库 UI 的「提升 / 注入」，或 tRPC `series.createCharacter` |
| 场景 | `seriesAsset(kind="scene")`：`data.locations[]` 放场景名 + 参考图路径 + 光线口径 | `series.createSeriesAsset` → `linkSeriesAsset` 到集 |
| 道具 | 同 `kind="scene"` 的 `data.props[]`（没有独立 prop kind，不新造枚举） | 同上 |
| 风格锚 / 镜头模板 | `kind="style"` / `kind="shot"`：`data` 放色板、提示词模板、禁止清单 | 同上 |
| 跨项目参考图 | `asset` 表（`asset.createFromTask` / `createFromUrl`），`localPath` 指向 `/api/generated/...` | 资产库 UI |

**命名约定**：`角色/造型`、`场景/时段`、`道具/状态`。测试素材与废片单独放，不与正式资产混放。

## 2. 视觉圣经模板（按项目填）

把下面每一项填成这个项目的具体值，再压成一段 `visualBible` 文本传给 `film.create`；
禁止项单独压成 `negativeExtra`。两者都并入每镜提示词，不新增 DB 列，可与 `styleSlug` 风格锚同时生效。

| 条目 | 填写位 | 要求 |
| --- | --- | --- |
| 主色板 | 【3–5 个颜色 + 各自用途】 | 写清用在哪里，不写「好看的颜色」 |
| 材质规则 | 【某种材质只能出现在哪里】 | 规矩越具体，越不容易跑偏 |
| 角色识别 | 【每个角色一个专属色 / 灯光色温】 | 扫一眼就能认出是谁 |
| 场景光线 | 【每类场景对应一种光】 | 光源数量、方向、时段、天气 |
| 胶片质感 | 【统一胶片型号 / 颗粒 / 镜头感】 | 写进每镜，不靠模型自猜 |
| 唯一例外 | 【哪一场故意打破规矩，为什么】 | 例外往往是情绪爆点；只此一处 |
| 禁止清单 | 【不要的风格 / 颜色 / 元素，逐条列】 | 与「要什么」同等重要 |

**调用形状**：

```ts
film.create.mutate({
  title: "【项目名】",
  script,
  type: "animation",
  visualBible: "【按上表压成的一段文本】",
  negativeExtra: "【禁止清单，逗号分隔】",
  // ... 工作流 id / 画幅 / 帧率
});
```

## 3. 结构化镜头提示词（像给摄影指导下指令）

每条 `filmShot.prompt` 按固定顺序写，缺项写「无」而不是省略：

```
画幅 | 【比例 / 全片统一】
参考 | @角色（只取外貌/服装） @场景（只取空间） @道具（只取形状）
主体位置 | 【谁在画面哪一格，占多大】
空间 | 【前景 / 中景 / 背景；哪里留白、留给什么】
动作 | 【怎么动、多快、镜头怎么运动】
光线 | 【光源数量、方向、天气、时段】
曝光 | 【压暗还是提亮；保暗部还是保高光】
质感 | 【胶片型号 + 颗粒 / 赛璐璐等】
声音 | 【环境音 / 对白；对白写进 params.dialogue，不塞进 prompt】
避免 | 【逐条列禁止项】
```

给多张参考图时**写明每张的作用**（「@角色 只取脸和道服」「@场景 只取空间」），
避免道具参考串到不该出现的镜头里。

## 4. 连续性：上一镜交给下一镜

- 机制：`Shot.continuityFromShotId` 在建片时写成 `filmShot.params.tailFrameFrom`；
  生成时 `generateVideoShot()` 从上一镜片段抽尾帧当本镜首帧，抽帧失败自动回落定稿首帧，不阻断生成。
- 当前**默认关闭**：需要时逐镜录入该字段，首镜留空；按 `index` 顺序把上一镜 id 填进 `continuityFromShotId`。
- 连续性靠**接力图**而不是「一句万能提示词」。选帧标准：人物位置清楚、道具完整、没有运动模糊。
- 状态突变交给快速转场，别让模型慢慢演——慢镜头会把不可能演穿帮。

## 5. 避坑与复盘

| 坑 | 表现 | 处置 |
| --- | --- | --- |
| 模型脑补 | 写「少一根手指」被补回来 | 从零「一根一根搭出来」，不描述缺什么 |
| 参考串戏 | 道具出现在不该出现的镜头 | 把该参考从这次生成拿掉，单独生成后期合成 |
| 渐变穿帮 | 状态突变在慢推镜里糊成一团 | 改用甩镜头 / 快切 |
| 废片 | 失败或不要的生成 | **不删**：`generated/` 按次产物留档，复盘时对照提示词 |

做完只是一半：成片导出后还要有宣发素材与交付清单，见
[多检出协同操作指南](multi-checkout-collaboration.md)。
