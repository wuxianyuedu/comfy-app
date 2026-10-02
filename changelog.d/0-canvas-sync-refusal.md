## Fixed

- 画布「服务端镜像」被服务端**明确拒收**时不再一声不响。此前
  `canvas-store.persistProjectToServer` 写的是 `catch {}`，于是「这个画布 id 属于别人」
  （装上归属闸之后的新后果）与「dev server 正在重启」在用户那边是同一个表现：
  界面显示已保存、换端口 / 换设备一看画布是空的，且毫无线索。现在按「重试有没有用」
  分两档 —— 确定被拒登记成一条可查的状态并弹一条带画布名字的提示（12s 不自动收起），
  暂时拿不到只留一行 `console.warn`（不打扰用户，下一轮自动保存会再试）。
  删除侧同一条判据（原先是 `.catch(() => undefined)`，而「本机删了、服务端没删掉」
  的后果是换端口时它再冒出来）。`refreshCustomNodes()` 的 `catch { return 0 }`
  第一次有了日志：「刷新失败」与「manifest 里零个节点」在调用方看来同形。
- 本地工作流目录配置变更不再监听一条**根本没人派发**的事件（对应的 `.env` 覆盖项
  早已被「设置里的 ComfyUI 安装路径推导」取代），连它那份自造派发方的用例一起删除。

## Added

- `src/lib/project-canvas/sync-notice.ts`：镜像失败分类（`isPermanentRefusal`，
  判据是 tRPC 码而非 HTTP 区间）、按「画布 + 原因」去重的可查登记表、
  状态变化时广播一次。界面上那句**按码翻成人话**（`FORBIDDEN` → 「这个画布编号
  已经属于别的用户，改个名字另存一份就能保住」），服务端原文与 `code=` 另走一行日志 ——
  翻不出人话的码走已翻译的原文，不硬编一句好话。
- `~/lib/error-message` 新增 `errorCode()`：从 unknown 抛值里取 tRPC 码，
  取值链与 `rawErrorDetail` 同源（此前码只被拼进日志字符串就丢掉了，
  调用方想分支只能读文案）。
- 应用事件 `comfyapp:canvas-sync-changed`。
- 「日志唯一通道」那条判据的浏览器侧豁免清单按**文件**登记了
  `sync-notice.ts`（首行 `"use client"`，三条判据逐条答得出）——
  这一族的日志在浏览器侧只能走 `console`，而登记与免检是两件事。

## Tests

- `tests/app-event-pairing.test.ts`（进固定守护清单，18 → 19 条）：`AppEvents` 表里
  每一条必须**既有派发方又有订阅方**。认字面量与 `export const X = "a:b"` 两种写法，
  测试文件不算任何一端，定义处自己不算端，先过 `stripComments`；
  配「扫描面非空」与合成源码反证（只有派发 / 只有订阅 / 两端都在 / 实参解析不出名字
  不许算端）四种形态各判各的。装机时照出的三条死端逐条处置在同一次提交里。
- 新增 38 条判据：`sync-notice.test.ts` 26 条（两档分类各 6+8 态、去重、成功撤销，
  「zod 的 JSON 原文不许进界面」与「日志里查得回码」各一条）、
  `canvas-store.test.ts` 5 条（含「被服务端拒不许动本地索引」这句语义）、
  `use-project-persistence.test.ts` 3 条（**挂载时先读表**那一格单独立一条 ——
  写镜像的入口不止画布那一页，工作区首页新建与画廊删除同样会发镜像而那些页面没挂
  提示器，广播发出去没人接且不排队重放，只订阅必然漏）、成对判据 4 条。

## Docs

- 台账 A3 补「客户端那一半」的收口；新开 **E9**（应用事件两端成对 + 三条死端处置 +
  本批没修的那一条：自定义节点注册表刷新现在确实没有通知通道）；
  规范 §11.2.1 新增「尽力而为的镜像要按重试有没有用分档，而有出口不等于发过一条事件」。

## Changed

- `AppEvents` 表从 6 条收成为 4 条：删除 `open-task`（只有监听）、
  `comfyapp:local-workflows-path-changed`（只有监听）、`custom-nodes:updated`
  （只有广播）；新增 `comfyapp:canvas-sync-changed`（两端都在场）。
