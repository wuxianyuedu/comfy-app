## Fixed

- GA `heavy-gates` 的「装 Tauri 的 Linux 系统依赖」在慢镜像时段把 63.5MB 的 deb 全量下载拖到 13min27s（78.6 kB/s，#4480 现场），15 分钟步级超时随时被击穿；而 apt 对下载的 deb 装完即清，每个碰壳的 PR 都从零下载同一批包。现把这批 deb 做成跨跑缓存：`/var/cache/apt/archives` 先 chown 给 runner 用户（cache action 以 runner 身份解包），`actions/cache` restore/save 包住 install，install 加 `APT::Keep-Downloaded-Packages=true` 显式留档、装挂了也落档。命中 ⇒ 只解包不下载，13 分钟级下载段消失。key 不带 sha / 时间——apt 按校验和认 deb，旧版包会被重新下载、不会装错。重试 / 超时 / 包清单 / 探针判据一字不改（#4294 / #4309 / #3580 的形状原样保留）。
