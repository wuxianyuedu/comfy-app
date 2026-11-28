# 《出端之刃》制作 playbook：AI 短片五步工作流

> 适用范围：本机单主控 + 多 UI-only 检出共同制作一部剧集（见
> [多检出协同](../superpowers/specs/2026-11-27-multi-checkout-series-collaboration.md)）。
> 方法论来源：《别再抽卡了：顶级AI短片的5步工作流》（https://mp.weixin.qq.com/s/MM-grkCy6SbSyPYkLH6kmg），
> 对 Higgsfield 电影节三部入围作品的工程拆解。本文件只保留**已映射到本仓库能力**的部分，
> 不照搬外部工具的操作界面。
>
> **本文是填好的实例**：通用空白模板见 [AI 短片五步工作流](ai-short-film-workflow.md)；
> 换项目时从那份模板起步，不要照抄本剧的色板与角色设定。

## 0. 总原则

生成次数多不等于乱抽卡。**先建资产库 → 立视觉圣经 → 像拍电影一样写每个镜头 → 上一镜交给下一镜**。
本仓库已有对应地基，不需要新造一套：

| 五步 | 仓库落点 | 当前状态 |
| --- | --- | --- |
| ① 资产库 | `character` / `seriesAsset` / `episodeAsset` / `asset` 表与 tRPC（`series-character`、`series-assets`、`asset`） | 表与 API 齐；本项目此前 0 行，需录入 |
| ② 视觉圣经 | `seriesAsset(kind="style").data`；`film.create` 的 `visualBible` / `negativeExtra`（ISSUE #5283） | 参数已接通，无需新列 |
| ③ 结构化镜头提示词 | `filmShot.prompt` / `negative` / `params.dialogue`；`prompt-builder.ts` 的景别与风格插槽 | 已有拼装链，按本文件模板写 |
| ④ 连续性接力 | `Shot.continuityFromShotId` → `filmShot.params.tailFrameFrom` → `tail-frame.ts` 抽尾帧 | 机制在，默认关闭，需逐镜录入 |
| ⑤ 废片留档 | `generated/` 产物树 + `asset` 表；不要删失败/废片文件 | 按次产物天然留档 |

## 1. 资产库（先建，后拍）

资产只生成一次，之后每镜从库里调用。目录/表对应：

| 资产类 | 库位置 | 登记方式 |
| --- | --- | --- |
| 角色（三视图 / 面部特写 / 每套造型） | `character` 表：`appearance` / `costume` / `styleTags` / `portraitUrl` / `portraits` | 系列角色库 UI 的「提升 / 注入」，或 tRPC `series.createCharacter` |
| 场景 | `seriesAsset(kind="scene")`：`data.locations[]` 放场景名 + 参考图路径 + 光线口径 | `series.createSeriesAsset` → `linkSeriesAsset` 到集 |
| 道具 | 同 `kind="scene"` 的 `data.props[]`（本仓没有独立 prop kind，不新造枚举） | 同上 |
| 风格锚 / 镜头模板 | `kind="style"` / `kind="shot"`：`data` 放色板、提示词模板、禁止清单 | 同上 |
| 跨项目参考图 | `asset` 表（`asset.createFromTask` / `createFromUrl`），`localPath` 指向 `/api/generated/...` | 资产库 UI |

**命名约定**：`角色/造型`（如 `炼-Look1-道服`）、`场景/时段`（如 `道场-夕` / `道场-夜`）、
`道具/状态`（如 `竹刀-裂纹`）。测试素材与废片单独放，不与正式资产混放。

## 2. 视觉圣经（本剧唯一真值）

### 2.1 色板与主色

| 用途 | 色 | 规则 |
| --- | --- | --- |
| 夜景基底 | 深蓝 `#1B2A4A` | 夜景街道、雨、校门一切外景的底色 |
| 道场暖光 | 琥珀 `#D9A24B` | 室内顶灯、木地板反光；暖光只属于道场 |
| 出端·危险 | 朱红 `#C8483A` | 只用于出端面命中瞬间、创可贴与红袖章的点睛 |
| 高光/纸面 | 米白 `#F2EFE6` | 胜者榜、道服、雪/雨的亮部 |
| 阴影 | 炭黑 `#202428` | 护具暗部、雨夜暗部；禁止纯黑死黑 |

### 2.2 材质与光线规则

- **道场**：暖黄顶灯单光源 + 木地板长条反光；窗格影子铺地；无霓虹。
- **夜景外景**：深蓝夜色 + 少量路灯点光；雨戏保持高对比，亮部不过曝。
- **体育馆**：顶灯均匀、无明显方向阴影，观众席虚化成色块。
- **人物识别色**：炼白底蓝纹道服 + 旧护具 + 第四圈胶布；九条深蓝道服 + 三道旧磨痕；
  佐伯红袖章 + 秒表；八云银灰护具；宫下眼镜 + 过长的竹刀。
- **质感**：2D 手绘赛璐璐，干净线稿，轻微胶片颗粒；**不**做照片写实、不做好莱坞油光。
- **唯一例外**：第六场团体赛最后一记出端面，全片唯一一次让朱红铺满画面 + 静音处理——
  这是情绪爆点，例外只此一处。
- **禁止清单**：photorealistic、cyberpunk neon、text/watermark、青橙色调、丁达尔光、
  镜头光晕、闪亮崭新的护具、多余手指/肢体、过曝高光。

### 2.3 怎么让规矩真正生效

建片时把上表压成一段文本传入（不再靠每镜重复写英文风格句）：

```ts
film.create.mutate({
  title: "出端之刃 · 第二集",
  script,
  type: "animation",
  visualBible: "深蓝夜景底、道场琥珀顶灯、朱红仅用于出端面命中；2D 手绘赛璐璐、干净线稿、轻微胶片颗粒；人物识别色固定",
  negativeExtra: "no photorealistic, no neon, no text/watermark, no teal-orange grade, no lens flare, no overexposed highlights",
  // ... 工作流 id / 画幅 / 帧率
});
```

`visualBible` 会并入每镜 `prompt`，`negativeExtra` 并入每镜 `negative`；styleSlug 风格锚仍可同时使用，
两者不冲突。没有新列、没有新表。

## 3. 结构化镜头提示词（像给摄影指导下指令）

每条 `filmShot.prompt` 按固定顺序写，缺项写「无」而不是省略：

```
画幅 | 16:9（成片层统一）
参考 | @角色（只取外貌/服装） @场景（只取空间） @道具（只取形状）
主体位置 | 谁在画面哪一格，占多大
空间 | 前景 / 中景 / 背景；哪里留白、留给什么
动作 | 怎么动、多快、镜头怎么运动
光线 | 光源数量、方向、天气、时段
曝光 | 压暗还是提亮；保暗部还是保高光
质感 | 赛璐璐 + 胶片颗粒（见视觉圣经）
声音 | 环境音 / 对白（对白写进 params.dialogue，不塞进 prompt）
避免 | 逐条列禁止项
```

给多张参考图时**写明每张的作用**（「@炼 只取脸和道服」「@道场 只取空间」），
避免道具参考串到不该出现的镜头里。

## 4. 连续性：上一镜交给下一镜

- 机制：`Shot.continuityFromShotId` 在建片时写成 `filmShot.params.tailFrameFrom`；
  生成时 `generateVideoShot()` 从上一镜片段抽尾帧（`-sseof -0.15`）当本镜首帧，
  抽帧失败自动回落定稿首帧，不阻断生成。
- 当前**默认关闭**（全仓没有自动赋值代码，也没有 UI）。需要时逐镜录入该字段；
  首镜留空。按 `index` 顺序把上一镜 id 填进 `continuityFromShotId` 即可。
- 连续性靠**接力图**而不是「一句万能提示词」。选帧标准：人物位置清楚、道具完整、没有运动模糊。
- 突变（如真人→瓷器那种状态切换）交给快速转场，别让模型慢慢演——慢镜头会把不可能演穿帮。

## 5. 避坑与复盘

| 坑 | 表现 | 处置 |
| --- | --- | --- |
| 模型脑补 | 写「少一根手指」被补回来 | 从零「一根一根搭出来」，不描述缺什么 |
| 参考串戏 | 道具出现在不该出现的镜头 | 把该参考从这次生成拿掉，单独生成后期合成 |
| 渐变穿帮 | 状态突变在慢推镜里糊成一团 | 改用甩镜头/快切 |
| 废片 | 失败或不要的生成 | **不删**：`generated/` 按次产物留档，复盘时对照提示词 |

做完只是一半：成片导出后还要有宣发素材（海报 / 短预告）与交付清单，见
[多检出协同操作指南](../guides/multi-checkout-collaboration.md) 与集级交付清单功能。
