## Added

- 把「AI 短片五步工作流」落到《出端之刃》制作（ISSUE #5283）：`film.create` 新增可选 `visualBible` /
  `negativeExtra`，把系列视觉圣经并入每镜正向 / 负向提示词（不动 DB schema，与 `styleSlug` 风格锚可同时生效）；
  新增制作 playbook（资产库 / 视觉圣经 / 结构化镜头提示词 / 尾帧接力 / 废片复盘）并登记文档索引；
  修正跨集资产需求里「未实体化」的过期描述，补齐多检出共享清单漏掉的 `seriesAsset` / `episode_asset`。
- 同批把《出端之刃》的系列 / 季 / 集、6 个角色、视觉圣经 + 场景 + 道具 + 镜头模板资产录入本项目 DB，
  回写 19 镜到 `production.shots`，并把视觉圣经并入暂停中的第二集 13 镜提示词（恢复即按新口径生成）。
