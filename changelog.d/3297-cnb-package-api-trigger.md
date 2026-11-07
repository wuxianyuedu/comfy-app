## Fixed

- **CNB 桌包档补 `api_trigger_package` 触发口，让 NSIS 现场读数真正能被跑到（ISSUE #3297）**：
  PR #3302 合进来的「打包·NSIS 工具现场读数」一直是**没有执行者的格**——定时那一跑
  2026-11-05 起已从 CNB 自托管节点迁到 GA `package-desktop.yml`（`.cnb.yml` 的 `master:`
  下不再挂 `crontab` 事件），而 `web_trigger_package` 手点按钮从没被点过
  （`cnb build get-build-logs --event web_trigger_package` 读数 `total=0`）；四次
  `makensis 0x2`（10-30~11-04）全发生在 #3302 合入之前，合入之后这一档再没跑过。
  补的 `api_trigger_package` 与现成的 `api_trigger_daily` 同构（服务端只认
  `api_trigger` 前缀），共用同一份 `*package_gates`、同一把 `*lock_package`、同一个
  `*package_fail_stage` 立案锚点，不另抄清单、不另起锁。触发口数量由
  `tests/no-platform-ci-config.test.ts` 的桌包档判据同批从 1 放宽到 2；§7.7 同步订正
  触发面事实（定时迁 GA + 补 API 口）并补记「读数格无执行者」的现场，生成态镜像同批
  重渲染。这一轮只补执行者、不猜 makensis 修法：读数要真触发一次拿到后再照本单
  「期望」分叉（两处落点不同值 ⇒ 改 `resolveTauriCacheRoot`；同值且 exe 能跑 ⇒ 查
  spawn 层 ACL / 杀软）。
