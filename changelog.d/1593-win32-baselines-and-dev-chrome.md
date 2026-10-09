## Fixed

- **像素层那条「mask 掉 Next dev 指示器」的判据一直是遮不住的，而且它自己就是不确定性来源**
  （ISSUE #1593 的现场之一）。`e2e/visual/support/page-baseline.ts` 的 `unstableChromeMasks`
  原先写的是「`count() > 0` 才追加 `nextjs-portal` 这条 mask」，两层问题叠在一起：
  ① 遮不住 —— 角标挂在 `nextjs-portal` 的 **shadow root** 里，宿主 `getBoundingClientRect()`
  实测 `0×0`（shadow root 下 16 个子节点），而 Playwright 的 mask 按元素 bounding box 画，
  0×0 等于什么都没遮（这一点文件注释里其实写着，但那条 mask 被留在原地当装饰）；
  ② 按 `count()` 决定加不加，而指示器挂载时机在水合之后 —— 于是**同一份 spec 两次跑用的
  是两套 mask**，这条判据本身变成了 flake 源。
  实测它有两种形态：左下角一枚小圆角标，或展开成一条约 `150×40` 的药丸（带版本 / 路由文字），
  后者单张能差出 **2700 像素**（`canvas-empty` 实测）。
  现在改成 `hideDevChrome()`：导航**之前** `addInitScript` 注入
  `nextjs-portal{display:none !important}`。选它而不是选 mask 的理由有三条 —— 像素确定、
  `dev` 与 `start` 两档在这块 chrome 上同形、且不像 mask 那样在基线上留一条品红色块
  （那会把被遮区域的布局退化一起遮掉）。**生产口径下没有这个元素 ⇒ 纯 no-op**，
  已入库的 `-linux.png` 不受影响。
  配套一条自检：`settle()` 里调 `expectDevChromeHidden()`，读**计算样式** `display` 而不是
  可见性（宿主本来就 0×0，`toBeHidden()` 对「0×0」和「display:none」给同一个绿，用它等于没判），
  所以 `hideDevChrome` 哪天失效是当场红，而不是安静地把角标烘进基线。
  **负向验证**：把 `hideDevChrome` 从画布档撤掉，`settle` 当场报
  `dev 指示器没被藏住（display=block）` —— 这条自检不是装饰。
- **画布档首次进画布的那条等待，预算给的是「元素在不在」而不是「冷编译完没完」**（ISSUE #1593）。
  `openCanvasView` 里 `.react-flow__pane` 用默认 5s：实测同一轮**串行**跑，先跑的
  `canvas-filled` 在这条上红（5s 内元素还没进 DOM）、后跑的 `canvas-empty` 绿 —— 两者之间
  唯一的差别就是那一次 Turbopack 按需编译已经把产物放进缓存了。改给 30s，与
  `e2e/settings-view.spec.ts` 等首屏页签条同一档。

## Added

- **win32 档补齐 8 张像素基线并成套入库**（ISSUE #1593 / 规范 §11.8）。
  新增 6 张：`canvas-empty` / `canvas-filled` / `login-desktop-light` / `models-empty` /
  `overlay-log-default` / `overlay-log-wide`；重录 2 张：`login-desktop` / `login-mobile`
  （旧图里左下角那个「N」角标是被烘进基线的 dev chrome，这次连同 `hideDevChrome` 一起清掉）。
  可复现性的判据不是「`--update` 那次写成功」，而是实测三条：① 按登记口径（`CI` 置空 ⇒
  `pnpm dev`）**串行**录一轮，10 张全部写成功；② 紧接一轮**不带 `--update` 的串行复跑**，
  **9/10 绿** —— 这一条才是 §11.8 要的「同一命令连跑两次都绿」；③ 唯一那张红的正是下面
  `Changed` 里登记出去的首页 `dark`。而首页 `light` 在更早一轮里红过（4457 像素）、这一轮绿 ——
  **它不是稳定红，是随现场漂移**，这种形态更不能入库。
- **`freezeComfyStats()`**：把 `/api/comfy/stats` 钉成 `{ online: false, processAlive: false }`。
  不钉的实测后果：`reuseExistingServer` 只看 8188 有没有人应答，而开发机上**真** ComfyUI 在跑时
  假服务器根本没绑上端口 —— 首页「本机算力」卡于是渲染真实显存 / 内存占用（`ram_free` 每秒在变），
  单张差出 142 像素，且每台机器都不一样。这种 PNG 不是基线，是机器指纹。
  钉成降级态而不是钉一组假数字，是因为那**正是**生产口径没有 ComfyUI 时真服务端回的东西
  （`src/app/api/comfy/stats/route.ts` 的降级分支同形），两档因此拿到同一张首页；
  「连着时数字长什么样」那一档的形态归 Storybook（`LocalComputeCard.stories.tsx`），
  与 §11.8 的页面级 / 组件级分工一致。

## Changed

- **`PENDING_PLATFORMS.win32` 由「整套 8 张待录」收窄成「只剩首页那两张」，`reason` 重写**
  （ISSUE #1593）。收窄之后这条账的性质也变了：它不再是「这台机器还没录」，而是
  「**这一屏当前录不出可复现的像素**」—— 首页有三处机器相关数据源没被桩掉（模型概览卡的
  真实目录计数、「最近项目」的服务端 hydration、readiness 的「连接中 → 离线」时序），
  实测录完立刻复跑仍差 4652 像素，且**同一张在两轮里一轮红一轮绿**。
  `reason` 里同时认下这笔代价：`pixel-run.mjs` 的前置判决是硬闸（缺一张就不起 webServer，
  退出码 2），所以 win32 档的像素回归在补齐这两张之前**没有执行者**，入库那 8 张只是「等着被跑」。
  没有把那张不可复现的 PNG 入库去换一个绿。

## Docs

- 规范 11 §11.8 三处同步：① 「两档像素互不相同」的**原因**从「dev 指示器遮不住」改成
  「口径闸守的是整体一致性」，并点名 `hideDevChrome`；② 那条 ⚠️ 从「暂时靠不在 dev 口径录基线
  来达成」改写为已解决的形态（含 `0×0` 宿主、shadow root 16 个子节点、`150×40` 药丸、2700 像素
  四组实测数），并写清自检为什么必须读 `display` 而不是读可见性；③ `PENDING_PLATFORMS` 那条
  新增「**缺有两种性质，`reason` 必须说清是哪一种**」—— 以及后一种要在登记时就认下「这一档
  暂时没有执行者」这笔账，而不是藏在「待录」两个字里。

## Tests

- **`tests/pixel-run.test.ts` 那条「真实检出上前置判决放行」不再断 `toBeNull()`**（ISSUE #1593）。
  它原先等于把「本机这一档此刻恰好成套」当成不变式 —— 而 `PENDING_PLATFORMS` 存在的意义
  正是让「某一档缺几张」成为一个**能被命名、且不阻断别的判据**的状态。改成判形状：
  齐备 ⇒ 放行；缺 ⇒ 话术必须走「待重录」那一支（且**不**是「平台没登记」那一支）并逐张点名。
  这样它仍然接真仓库（能抓到登记表被改坏），但不再要求仓库在任何一个时刻成套。
  **负向验证**：把 `PENDING_PLATFORMS` 的 `win32` 键改名（等价于删登记）后重跑，
  只有这一条红、其余 15 条照绿 —— 说明它判的是分支，不是一句恒真。
