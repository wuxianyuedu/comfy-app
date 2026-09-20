## Changed

- **「把用户选的文件读进来」收成一个出口**（规范 16 §16.2.4.27，**P24 硬闸**）：全库 **6 处**各写一遍「把 `File` 读成文本 / data URL」，而差别不在「怎么读」，在**两个语义决定**上 —— **怎么读**两派（4 处 `await file.text()`、2 处手搓 `new FileReader()` + `onload`/`onerror` 包 Promise），**「读到空算不算失败」**两派（两处把 `typeof result === "string" ? result : ""` 与「读失败」压成同一个 `""`，调用处只能靠 `if (!dataUrl) throw` 反推；另两处 `void file.text().then(…)` **连 rejection 分支都没有** —— 读失败被整个吞掉，用户看到的是「什么都没发生」）。

  - 出口 `~/lib/file-io` 的 `readFileAsText` / `readFileAsDataUrl`（`DOMAIN_EXEMPT`，与 `browser-io` / `display-value` 同款）。两条通道依次尝试：`file.text()` → `FileReader`（与剪贴板的「两条通道」同款取舍）。
  - **失败一律抛出**（不返回空串）：`readFileAsText` 的空串是**真实内容**（空文件），`readFileAsDataUrl` 的空值则**一定是失败**（data URL 不可能为空）。两者分开表达。message 是可直接展示的中文文案，`cause` 保留原始错误。
  - 迁 7 处：设置页用量测试的图片转码、工坊封装页的本地图上传（顺带删掉调用处那句 `if (!dataUrl) throw`）、工作流库 JSON 导入、影片工作室剧本导入、工坊角色设计器与分镜规划器的外部导入、视频队列的 txt/csv 导入与工坊剧本文件导入（这两处补上此前缺失的 `.catch`）。

- **「在浏览器里持久一件小事」收成一个出口**（规范 16 §16.2.4.28，**P25 硬闸**）：**9 个文件**、十余处各写一遍「读 / 写 `localStorage`」，而**怎么判「没有浏览器」有三套写法**同时在用 —— `typeof window === "undefined"`（多数）/ `typeof localStorage === "undefined"`（`canvas-store`）/ 压根不判只靠 `try/catch`（`UpdateCheckProvider`）。三者在 SSR、jsdom、隐私模式下**行为不同**：只判 `window` 的那几处在「window 在、storage 被策略拒」时会抛异常，外层 `try` 兜住的其实是另一件事（`JSON.parse` 失败）。

  - 出口 `~/lib/browser-storage` 的 `hasBrowserStorage` / `readStorageItem` / `readStorageJson` / `writeStorageItem` / `writeStorageJson` / `removeStorageItem`（`DOMAIN_EXEMPT`）。
  - **两个判据都要**：`window` 判 SSR、`localStorage` 判隐私模式（访问它本身可能抛，整段包 try）。三条口径：**没有浏览器 = 没有这个键**（需要区分时用 `hasBrowserStorage()`）；**坏数据与「没存过」都回落默认值**；**写 / 删失败静默但返回 `boolean`**，让在意的调用处能表达「本次会话内有效但没记住」。
  - `readStorageJson` 的第三个参数是**可选的窄化函数**（`Number.parseInt` / `raw === "preset" ? …`），省掉各处重写一遍解析。
  - 迁 9 个文件：画布偏好、面板加宽档、工作流运行态、尺寸预设、工坊草稿与项目索引、更新检测开关、工作流表单对齐倍数与录入方式、画布项目索引（`canvas-store` 的 12 处 `typeof localStorage` 与自持 `safeParse` 一并删掉）。

- **「在输入框里按 Enter 提交」收成一个出口**（规范 16 §16.2.4.29，**P26 硬闸**）：全库 **11 处**各在 `onKeyDown` 里判键，而差别在**两个语义决定**上 —— **Enter 要不要 `preventDefault`**：6 处写了、**5 处没写**（没写的那几处在 `<form>` 里 Enter 会触发隐式 submit，「回车新增标签」变成「回车提交整页」；唯一没被波及的落点靠的是「它恰好不在 form 里」）；**Esc 取消要不要复位草稿**：复位 3 处、其余留在原值（下次点开看到上次输入一半的内容）。

  - 出口 `~/components/ui/use-enter-commit` 的 `enterCommit` / `isCommitKey`。形态取「返回 `onKeyDown` 属性对象」而不是 hook（调用点在 JSX 里，与 `mediaDragSourceProps` 同款 —— 硬做成 hook 会逼着每个调用点先拆组件）。
  - 四件事一次给全：**`preventDefault` 恒开**、**`onCancel` 给了才接管 Esc**（「只提交不取消」是合法形态）、**`ignoreIme` 默认开**、**`excludeShift` 默认开**。
  - **修掉一族更差的写法**：`AgentOverlay` 的「Enter 发送、Shift+Enter 换行」此前**不判 IME** —— 中文输入法下**拼音未上屏的 Enter 会被当成发送**（把半截拼音发给 AI）。现在 `isComposing` 与 `keyCode === 229` 两条都判。
  - 迁 11 处：模型标签新增与改名、画布缩放、项目重命名、工作流标签、数值输入框、模式多选搜索框、工坊角色属性自定义添加、Agent 对话、角色简介 AI 生成、工坊项目标题重命名与新建。
  - 顺带把 **2 处 `role="button"` 自绘元素改成基元**（`RgthreeBodies` 的旁路开关 → `<Button variant="ghost">`；`NodePreviewCard` 的折叠头 → `<Button variant="ghost" className="rounded-none …">`）—— 它们此前在 `onKeyDown` 里复刻浏览器对原生按钮的默认行为，Enter/Space 与焦点语义本可以免费拿到。外观由 `className` / `style` 逐条接管（§16.2.4.2 第 9 条「渲染结果不变」）。

## Docs

- `docs/standards/16` §16.2.3（判据表补 P24/P25/P26，硬闸清单由二十件事扩到二十三件）、§16.2.4 台账新增「读用户选的文件」「浏览器持久化」「Enter 提交」三行、**新增 §16.2.4.27 / §16.2.4.28 / §16.2.4.29**（各份写法、出口口径、判据锚点与反面用例）。
- 三个新出口按 §18.14 **同批**做完三件事：`DOMAIN_EXEMPT` 登记（**R13 第一次就拦下了两个 lib 根模块** —— 与 `overlay-z.ts` / `list-filter.ts` 是同一课）、`coverage.include` 与 `thresholds` **两处同批改**（只写门槛不进 `include` 会让门槛静默失效，`ui/file-picker.tsx` 的前车之鉴），门槛按实测值设（`file-io` 100/100/100/100、`browser-storage` 95/100/90/90、`use-enter-commit` 100/100/100/100）。
- `tests/check-ui-primitives.test.ts` 补 **12 条**契约（三条判据各自阻断、各自的「更差写法」也要数、各自的反面用例、合规者不误伤、不进基线）；`tests/ui-primitives-coverage.test.ts` 从**另一侧**钉住三个出口的导出名与业务引用 —— 硬闸挡得住「新增自绘」，挡不住「抽出出口但没人用」。
