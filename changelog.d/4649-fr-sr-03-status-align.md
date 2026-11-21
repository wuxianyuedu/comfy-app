## Fixed

- 产品文档状态对齐（#4649）：FR-SR-03「跨集资产复用」在 catalog 写「计划中」、specs 写「已实现」，两处相反。按代码现状核定：容器层（`series`/`season`/`episode`，#2477）与系列角色库（`character`/`episode_character` + 引用提示 / 反向查询，#2508/#2801）已上线；风格锚仅 `series.styleSlug` 档位引用、场景仍是 `production.scenes` JSON 列，尚未实体化——FR-SR-03 收敛为「部分实现」。catalog 状态词表新增「部分实现」档，§2.15 前言与 FR-SR-01/02/03 状态列、§3 缺口索引、specs 验收第④条、overview 领域模型表同批对齐。
