## Fixed

- PR 失败立案在构建列表被平台权限挡（`cnb_cli` 缺 `repo-cnb-history:r`，errcode 10025）时，改认平台注入的环境变量（`CNB_BUILD_ID` / `CNB_PULL_REQUEST_IID` / `CNB_BUILD_EVENT`）认身份，继续按 `get-build-status` 逐格读数判红并落评论/建单，不再「绿着空转、PR 红了没人立案」（#3491）
