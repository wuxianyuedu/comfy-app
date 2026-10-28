## Fixed

- **工坊自动保存不再抹掉 production 侧的机器衍生字段（#2615，拍板：保存合并）**：
  `PUT /api/production` 在整列 upsert 前按同 id 继承缺键的衍生字段——
  镜头继承 `rev / review / reviewHistory / imageReview / humanVerdict`
  （SHOT_DERIVED_FIELDS），角色继承 `humanVerdict`（CHARACTER_DERIVED_FIELDS，
  为 #2623 的裁决入口预留）。规则是「入参缺键才继承」：草稿未来演进携带时
  以入参为准，继承只兜「草稿不知道」，不覆盖「有人明确写了」。
  修复前现场：#2479 / #2480 写进 production 的评审与裁决，会在用户下一次
  在工坊编辑任何东西的 600ms 防抖保存中被整列覆盖抹掉（run 引擎的 rev
  续跑判据同理失忆）。
  纯助手 `inheritDerivedFields`（payload.ts）+ 四条用例（缺键继承 /
  显式带值以入参为准 / 无 id 与无 prior 原样保留 / 非对象穿过）。
