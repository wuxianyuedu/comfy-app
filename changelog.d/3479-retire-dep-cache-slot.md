## Changed

- **依赖面缓存槽退役（ISSUE #3479，#3474 评估）**：执行面为零（PR 档不再装依赖、
  其余安装格从不置 `COMFY_CI_SLOT`）⇒ 读数格、`applySlot` 执行档、配额 / TTL
  淘汰器、CLI 读数整族剪掉；机制与四条实测留档规范 §13.5.3.4.3 / §13.5.37。
  **同一份文件里各有一半是活件的共用底座**（引用面逐个核过）：`ci-cache-slot.mjs`
  保留四套常驻根共用的一份 store 卷推导（构建缓存槽 / 成品 / 工具镜像三套根），
  `ci-slot-apply.mjs` 保留槽锁与盘面原语（`acquireSlotLock` / `hasRoomForSlot` /
  `statfsFreeBytes`）—— 整删会把还在承重的构建缓存槽一起删掉。
  `ci-install-deps.mjs` 剪净槽支路（指纹账本与「依赖面没动就不装」判据一字未动）；
  构建缓存槽不在退役之列 —— 执行者已随 #3504 迁 GA（`daily.yml` /
  `oneshot-build.yml` 置 `COMFY_CI_BUILD_CACHE=1`），它暂无淘汰器这一点如实记进规范。
