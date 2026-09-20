## Changed

- 按形态扫描又清出三件事的重复实现，各收成一处（ISSUE #672，规范 16
  §16.2.4.30 ~ §16.2.4.32），三条新判据 **P27 / P28 / P29** 一上来就是硬闸：
  - **「把一次异步动作的结果接到反馈通道上」**（全库 21 处 → 0）：新增
    `~/lib/async-action` 的 `runAsyncAction` / `toActionResult`。收口前
    「置忙 → 调用 → 成功/失败各写一遍 → `finally` 清忙」这段样板在设置页（12 个动作）、
    工作流库（8 个）、历史列表与详情、模型标签、训练工作室、影片工作室、画布拖放、
    工坊对话、模型目录配置里各写一遍，而**反馈通道有五种**、**成功那一侧有三种写法**
    （「成功静默」与「忘了写成功分支」在代码上完全一样），失败文案又有三处是
    自己拼的 `e instanceof Error ? e.message : String(e)`（非 `Error` 抛值会渲染成
    `[object Object]`）。出口把结果归一、失败一律走 `errorMessage`、
    成功文案按「`successText` → 信封 `detail` → 静默」三层取，通道由调用处注入。
  - **「一张媒体图的自然尺寸是多少」**（5 处 → 0）：新增
    `~/lib/media/natural-size` 的 `readNaturalSize` / `naturalAspectRatio` /
    `isPortraitMedia` / `formatNaturalSize`。收口前预览那处 `if (el.naturalWidth && …)`
    把 `0` 静默跳过、其余几处拿到 `0` 照算 —— 后者得出 `NaN` / `Infinity` 的比例，
    渲染成「0 × 0」或把容器高度算崩。出口一律给 `null`（`0` 是「还没解码完」，
    不是「尺寸是 0」），竖图判据是三态。
  - **「把一组值写成查询串」**（两种写法并存 → 一种）：新增 `~/lib/query-string`
    的 `buildQueryString` / `withQuery` / `readQueryParam`。收口前
    `URLSearchParams` 会把 `undefined` 写成字符串 `"undefined"`（可选参数还得自己
    `if` 一层）、空串与「不传」两派、重复键表达不一、**12 处手拼里 3 处漏了
    `encodeURIComponent`**（文件名带 `#` / `&` 时静默打到另一个端点）。
    媒体预览地址再收一层到 `~/lib/media/media-url` 的 `comfyImageUrl` /
    `mediaPreviewUrl`（`/api/images` 的 5 处手拼清零；空引用给 `null`，
    不再拼出 `?filename=` 让服务端报错）。
- `check-ui-primitives.cjs`：`HOOKS_ALSO_SCANNED` 逐条列出「逻辑层同样成立」的判据
  （P12 / P13 / P20 / P24~P29）—— 此前 `hooks/` 是按目录整片豁免的，而 P27 的存量
  恰恰 19/21 在逻辑层。顺带翻出并修掉 P13 的 2 处存量
  （`use-material-library` 只 `trim()` 没折小写）。
- 本批三条出口登记进 `DOMAIN_EXEMPT`（跨域顶层单例）并同批进
  `vitest.config.ts` 的 `coverage.include` + `thresholds`（门槛取实测值）。
