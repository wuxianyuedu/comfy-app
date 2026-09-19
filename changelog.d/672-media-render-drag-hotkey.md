## Changed

- **「渲染一张可能失败的媒体图」收成一个出口**（规范 16 §16.2.4.21，**P18 硬闸**）：全库 **18 个文件**各自裸写 `<img>` / `<video>`，而**失败这一侧有四种写法、四种后果** —— `HomePage` 项目缩略图用 `event.target.style.display = "none"`（直接改 DOM、绕过 React，失败那格**留下空洞**）、`TrainingStudio` 数据集缩略图用 `style.visibility = "hidden"`（同款，只换了个属性名）、`WorkflowImagePreview` 自持 `useState(failed)` + 「图片不可用」方块、`SettingsPrimitives.FieldImagePreview` 同上换成长文案；而**另外 14 处压根没有兜底** —— `<img>` 失败就交给浏览器画破图图标。另有 `loading="lazy"` 只有 2 个写了、`decoding` 只有 1 个写了的静默漂移。

  - 出口 `~/components/ui/media-thumbnail` 的 `MediaThumbnail`：形态（`<video>` 就地播放 / `<img loading="lazy" decoding="async">`）与**失败兜底**都由出口给。`fallback` 三态 —— `"placeholder"`（缺省，中性占位**继承调用处的盒子**，所以不跳布局也不留空洞）/ `"none"`（宁缺勿错）/ 自定义节点（设置页给的是「怎么换掉这个地址」的可行动文案）。
  - **`as` 覆盖后缀推断**：`ResultCard` 的 `mediaType` / `kind` 已判过视频，而 ComfyUI 某些节点把视频帧存成 `.png` —— 出口自己判后缀但**不推翻**调用处已经知道的答案（这条是被 `ResultCard.test.tsx` 既有的「mediaType=video 强制走视频分支」当场抓出来的）。
  - **`src` 变化重新给机会**：列表复用同一实例时，上一张图的失败不再传染给下一张（此前各落点自己管，漏掉的就是「换图仍是破图」）。
  - 迁 18 个文件、**23 处**：`ContentAssetNode`（×3）、`FinalComposer`（×2）、`VideoStudio.parts`（×2）、`HomePage` / `TrainingStudio` / `WorkflowImagePreview` / `SettingsPrimitives` / `ModelCard`（失败落回与「没有封面」同一个渐变底）/ `ResultCard` / `ProjectOutputs` / `FilmStudio` / `ShotStudio` / `CharacterPortraitStudio` / `StoryboardPlanner.parts` / `WorkshopEncapsulationPanel` / `WorkflowCanvasNodePreview` / `me/works/page.tsx` / `UsageTestDialog`。

- **「把一张媒体图变成可拖拽源」收成一个出口**（规范 16 §16.2.4.22，**P19 硬闸**）：`HistoryPanel` 与 `MaterialLibraryPanel` 的网格 / 列表**四个视图逐字重复四遍**同一段代码，而真正的病灶不在重复 —— 消费端 `use-canvas-drop` 只做 `JSON.parse` + 类型断言，**形状对不上是一次静默丢投**（拖到画布上什么都不发生，也没报错）。

  - 出口 `~/components/ui/media-drag-source` 的 `mediaDragSourceProps` 是**纯函数**（调用点都在 `Array.map` 里，硬做成 hook 会逼着每个列表项先拆成组件）：返回 `{ draggable, onDragStart, className }`，调用处整份摊到元素上；可拖与光标类是**同一个判据**（此前四处都是「`draggable` 一个判据、光标类另一个判据」，改一处漏一处）。
  - `MEDIA_DRAG_MIME` 与 `MediaDragPayload` 也在这里导出 —— 落点的 `MediaDropPayload` 就是它加上 `position`，**源端与落点共用一份**。
  - `displayNameFromUrl` 接管「文件名从路径里怎么取」（剥查询串 / 锚点后取最后一段，**空段回退原串**而不是给一个看不出来的空名字）—— 此前是 `HistoryPanel` 的 `cover.split("/").pop() ?? id` 与 `MaterialLibraryPanel` 的 `item.name` 各写一份。

- **「注册一个全局快捷键」收成一个出口**（规范 16 §16.2.4.23，**P20 硬闸**）：全库 **6 处**各自 `addEventListener("keydown")` + 手写清理，而**修饰键判据各不相同** —— `LogProvider`（Ctrl+Shift+L）与 `UpdateCheckProvider`（Ctrl+Shift+U）只判 `ctrlKey && shiftKey`，**macOS 上按 ⌘ 没有任何反应**（用户不会认为「这个应用没有这个快捷键」，只会认为「它坏了」）；`json-viewer`（⌘/Ctrl+F）判了 `metaKey || ctrlKey` 却**不过滤输入焦点**（在别的输入框里也把 ⌘F 抢走）。

  - 出口 `~/components/ui/use-hotkey` 的 `useHotkey`：`mod` 跨平台（⌘ / Ctrl 各按平台算一个，显式 `ctrl` / `meta` 仍可用但要在调用处写明理由）、`enabled`（不满足时**不注册**，而不是注册了在 handler 里 early return —— 后者顺序不可控）、`filterInput`（默认开；`ScriptMarkdownEditor` 是它的反例，全屏编辑器**刻意**传 `false`，理由写在调用处）、`preventDefault`。
  - `matchesHotkey` 单独导出：**declared 只约束声明了的东西** —— 未声明的修饰键必须没按，否则一个不声明修饰键的监听会把别的组合键一起吞掉。
  - 迁 6 处：`LogProvider` / `UpdateCheckProvider`（这两处的 ⌘ 从此可用）/ `MessageCenterPanel` / `WorkshopHeader`（Esc，`filterInput: false` —— 用户可能正在改名输入框里按 Esc 放弃编辑）/ `ScriptMarkdownEditor`（⌘S / ⌘Z / ⌘⇧Z 三条，顺带把「保存」与「撤销」从同一个 handler 里拆开）。

## Docs

- `docs/standards/16` §16.2.3（判据表补 P18/P19/P20，硬闸清单由十四件事扩到十七件）、§16.2.4 台账新增三行、**新增 §16.2.4.21 / §16.2.4.22 / §16.2.4.23**（三份形态账、出口口径、判据锚点与反面用例）。
- `tests/ui-primitives-coverage.test.ts` 补三个新出口的业务引用门槛；`tests/check-ui-primitives.test.ts` 补 **12 条**契约（三条判据各自阻断、各自的反面用例、合规者不误伤、更差的写法也数得到、不进基线）。
- `vitest.config.ts`：三个新出口**同批**进 `coverage.include` + 按实测值设门槛（只写门槛不进 `include` 会让门槛静默失效 —— P16/P17 那批的教训）。
