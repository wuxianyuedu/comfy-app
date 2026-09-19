## Fixed

- **按形态再扫一遍「谁在实现同一件事」：五条账收口，各 3~7 份实现**
  （规范 16 §16.2.4.10，ISSUE #672）。上一批的结论是「按目录名看不见重复、
  按形态才看得见」，这一批把那句当方法用了一遍 —— 不问「库里有没有 `clipboard`
  这个词」，而问「谁在把一段文本送出去 / 谁在把时间写成给人看的字」。

  - **剪贴板写入 4 份 → 1 份**（`~/lib/browser-io` 的 `copyText`）。此前四份的
    兜底写法各不相同，**六个落点更是完全没有降级链路** —— 直接
    `navigator.clipboard?.writeText(...)` 的写法看起来「已经用了可选链、应该没
    问题」，而它在 Tauri 的 `http://` 非安全上下文里恰好**把失败吞掉**。
  - **Blob 下载 7 份 → 1 份**（`downloadText` / `downloadJson`）。此前
    `URL.revokeObjectURL` 与 `a.click()` 的先后顺序不统一，有 3 份写成了先 revoke
    —— 大文件会拿到已失效的 URL，只因小文件同步完成而一直没暴露。
  - **相对时间 5 份 → 1 份**（`~/lib/time-format` 的 `timeAgo`）。档位与后缀此前
    各不相同（一处 30 天封顶后转日期、两处每档带「修改」后缀、一处不带），
    其中 `workspace/page.tsx` 与 `WorksGallery.tsx` **两份逐字相同**。
  - **时刻格式化 6 份 → 1 份**（`formatClock`）。带毫秒的两处逐字相同；
    `workshop` 那 4 处裸调 `toLocaleTimeString()` **连区域设置都没固定**
    （宿主 12 小时制时会多出 AM/PM，把紧凑的日志行撑开）。
  - **字节容量 3 份 → 1 份**（`~/lib/format-bytes` 的 `fmtBytes`）。这条最值得记：
    出口**早就存在**，漏网的两处一个叫 `fmtSize`、一个是文件内私有的
    `formatSize` —— 按函数名扫会全部漏掉；两者的降档阈值还写成 `>` 与 `<` 两套，
    1024 字节整这一档给出不同答案。

## Added

- **`~/lib/browser-io`**：`copyText`（返回 `boolean`，Clipboard API → 临时
  `<textarea>` + `execCommand` 两条通道，含 `navigator` 存在性判定）、
  `downloadText`、`downloadJson`。`src/lib` 的顶层单例，已登记
  `check-file-structure.cjs` 的 `DOMAIN_EXEMPT` 并在 `vitest.config.ts` 设实测门槛。
- **`~/lib/time-format`**：`timeAgo`（`maxDays` / `suffix` 两个**显式**选项承载
  调用处差异，不做「统一成一种」）、`formatClock`（`millis` 档）。同样按顶层
  单例登记 + 设门槛。
- **判据 P5/P6（硬闸）**：`check-ui-primitives.cjs` 新增「视图里不得再写
  `navigator.clipboard` / `document.execCommand(`」与「不得再写
  `URL.createObjectURL(`」，与 P4 同性质 —— 口径是**必须为 0**，不进棘轮基线，
  `--update` 也不接受带违规的基线。`tests/ui-primitives-coverage.test.ts` 再从
  另一侧钉住出口模块的导出名与「至少一处业务引用」。
- `tests/check-ui-primitives.test.ts` 新增 6 条（P5/P6 各自的阻断、`--update`
  拒绝放水、计数不进基线）。

## Changed

- 调用处**零行为变化**：`history-utils.ts` / `history-panel-types.ts` 保留原名
  转发（消费方一行未改）；`logs/log-format.ts` 的 `formatTime` 跨天补日期逻辑
  留在原处，只把「时刻本身怎么写」换成 `formatClock`；`log-export.ts` 的
  `copyLogText` / `downloadLogText` 签名不变。
- `ui/json-viewer.tsx` 的复制按钮也改走 `copyText` —— 它是 `ui/` 工具生成目录里
  的语义正确性判断（与 §16.2.5 的 `z-*` 同款：语义正确优先于「不手改」）。
