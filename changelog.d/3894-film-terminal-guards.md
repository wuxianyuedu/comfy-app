## Fixed

- film 成片终态守卫补强（#3894；#3867 已收口 claimComposing/markDone 的取消竞态，
  本条补齐其余终态互覆面）：`markFailed` / `markCancelled` 改为条件更新（仅当当前
  状态非 DONE/FAILED/CANCELLED 才写入）——超时判死不再覆盖取消、失败原因取第一次
  落库那条；`markDone` 的守卫从「仅挡 CANCELLED」加强为全终态；`film.cancel` 端点
  先查状态，对终态幂等返回现状态。无守卫的孪生写点 `markGenerating` /
  `markComposing` 删除（生产路径本就走 `claim*` 条件抢占，测试夹具同批迁移）。
