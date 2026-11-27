## Changed

- 风格库 `style` 分类内置画风从 7 条扩充到 **115 条**（#5097）：新增 108 条日系动漫画风细分，
  按工作室 / 受众 / 上色技法 / 时代 / 题材 / 漫画流派 / 混合技法整理（新海诚 / 吉卜力 /
  京阿尼 / ufotable / 赛璐璐 / 厚涂 / 少年漫 / 少女漫 / 四格 / 三渲二 …）。
  仍走 Skill 系统唯一出口 `BUILTIN_SKILLS`（`skill.list` 取数、`skill.create` 新建、
  `ensureBuiltIns` 按 slug 补缺），数据拆成 3 个种子文件并统一带 `anime-` slug 前缀防撞号；
  视图与搜索能力不变。同批用例钉住 100+ 数量、slug 唯一与分类合法。
