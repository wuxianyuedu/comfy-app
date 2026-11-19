## Fixed

- `run.cancel` 不校验当前状态（#3901）：done / failed 的 run 已收尾，取消现在
  原样回显现状态、不改写终态（与 pause / resume / approve 同款「先查再写」）；
  重复取消幂等返回。running / awaiting_approval / paused 照旧写成 cancelled。
