## Fixed

- **素材库的 scope 现在判归属：别人的项目 id 填进参数不再能读、能写、能删**（安全台账 A12）。
  素材库是文件系统支撑的，分片方式就是**把画布项目 id 直接当目录名**
  （`public/generated/materials/<projectId>/<folder>/<file>`）—— 「scope」这个参数于是
  同时是路径片段与权限边界。旧代码只判了前者（`sanitizeScope` / `sanitizeFileName` /
  `folderDir` 的包含断言都在，形状攻击如 `../../etc` 会被收成 null 或落进共享区），
  没判后者，于是两条越权路都通着：
  - `scope=cross` 直接返回 `listScopes()` —— 等于把「本机都有哪些项目」当成一份可枚举
    清单交出去，再顺着它翻每个项目的素材；
  - 把别人的 `proj_*` 填进任意一个参数，就读得到别人的文件、写得进别人的面板、
    删得掉别人的文件。
    两个入口（tRPC `material.*` 与 REST `/api/materials`）**各写一份** `resolveScopes`，
    两份都漏了同一条判据 —— 正是 §12.12 说的那种形态。
    现在判据在 `~/lib/media/materials.ts` 一处（`materialScopeOwnership` /
    `visibleMaterialScopes` / `canWriteMaterialScope`），两个入口都吃它。
    **结论是三态而不是两态**：`mine` / `foreign`（一律看不见、不可写）/ `unclaimed`
    （共享区，或库里还没有这一行）。第三态不是松口，是不堵死正常路径：画布 id 由客户端
    生成、向服务端的镜像是尽力而为（离线时错误被吞掉），把「还没同步上来的新项目」
    判成不可写会让上传素材直接失败 —— 与台账 A11 同一族的「客户端先有 id、服务端后知道」。
    处置口径照搬 A2 / A3：**越权与不存在同形**（REST 给 404、tRPC 给 `NOT_FOUND`，
    不给探测项目 id 用），且写 / 删的拒绝发生在 `writeFile` / `rm` / `unlink` 之前。

## Added

- **36 条判据，两个门各自一套**（同一套判据只测一边等于另一半没 gate）：
  `src/server/api/routers/material.test.ts` 18 条 + `src/app/api/materials/route.test.ts` 18 条。
  覆盖：本项目只见自己 + 共享、别人的项目与「没素材」同形、cross 不再枚举全库、
  搜索走同一条归属判据、未登录 401 且一次磁盘都不读、写别人的格子 → 拒绝且
  `mkdir`/`writeFile`/`rm`/`unlink` 一次都没发生、分类必须是枚举而非路径片段、
  文件名里的目录成分被剥掉、重名追加 `-1` 不覆盖、形状攻击的 scope 落到共享区而不是越界。
  用例里整个 `fs` 换成内存假象并**记录读写调用** —— 既不往仓库 `public/` 里造目录，
  又能把「没落盘」这句断言做实。
  反向验证两处：把写闸短路 → 恰好 4 条红；把读侧收窄摘掉 → 恰好 3 条红。
- **三个入口按实测进覆盖率门槛**（§18.6）：`media/materials.ts` 95/80/85/90 一档、
  `routers/material.ts` 100/75/90/100、`api/materials/route.ts` 85/75/80/80。
  后两条是**实测登记不是回退**：REST 那条缺的主要是 500 兜底与 stat 失败分支，
  判据本身都测到了。
- 新开台账 **A13**：`/api/generated/[...path]` 是纯路径静态流 —— 只判「解析后仍在
  `public/generated` 之内」，**没有会话校验也没有归属**，任何能访问该端口的一方都能按路径
  读走所有人的产物与素材（A12 把列表收紧之后，直接猜路径读仍然敞开）。本轮没修，
  理由与最小一刀都写在条目里 —— 加会话校验会牵动桌包与 `<img>` 的加载语义，
  而「有会话」也不等于「有归属」，硬加一层只会有归属的假象。
