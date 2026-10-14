## Fixed

- **没配 ComfyUI 路径时，侧栏「ComfyUI」页的状态不再永远停在「状态检测中…」（ISSUE #1900）**：`ComfyUI 路径` 从来没填过，那一页的状态行与圆点却一直显示「ComfyUI 状态检测中…」——既不报「未运行」也不报错，用户看着一个一直在转的探测。根因是 `status.ts` 的 `snapshotOnce()` 把「没配路径」这条**完整事实**错标成了「没得查」：路径为空时直接 `return emptySnapshot()`（`didQueryProcTable: false`），而上层 `deriveComfyUiStatus()` 把 `!didQueryProcTable` 读作「一条进程表查询都没发出 ⇒ 证据不足以上报故障」并把 `probing` 置真（这条判据本身是为 ISSUE #442 的启动空窗写的）。没有路径可查是**事实齐备**，不是「什么都还没查」，于是永远等不来把它改口的那个事件。
  - 顺带修掉一处漏判：原来那条早退落在「配置端口是否应答」探测**之前**，连「用户自己开了桌面版、恰好监听在默认/配置端口」这种本该认出的情形也一并跳过。现在早退挪到端口探测**之后**，端口也没人应答才算事实齐备，那时返回 `didQueryProcTable: true`（没有路径 ⇒ 没有 `main.py` / 解释器候选可枚举，这就是「查完了」）。
  - 回归测试：`src/lib/comfyui/status.test.ts`（「未配置路径且无 bound 子进程 → 未运行」补 `didQueryProcTable === true`、「未配路径时仍探一次配置端口」）、`src/lib/comfyui/lifecycle-derive.test.ts`（「没配路径（探过端口、无候选可查）→ 未运行，不是『检测中』」）。规范 §5 排障表新增一行症状 → 根因 → 修法。
  - **未做**：路径存在、但连一条解释器候选都组不出来时仍维持「检测中…」——那一格是**真的**没得查（有路径却认不出实例），与「没配路径」是两件事。

- **工作区懒加载视图撞上「分块加载失败」时自愈，不再整屏崩成「页面出错了」（ISSUE #1900）**：点侧栏「ComfyUI」页里那枚「去设置里配置」跳到设置屏时，控制台一条 `ChunkLoadError: Failed to load chunk /_next/static/chunks/<hash>.js from module … [app-client] (escript, next/dynamic entry, async loader)`，整屏替换成错误页。成因全在 dev server 一侧：这些屏都是 `next/dynamic` 懒加载的，页面首帧只拿到「该去哪个分块」的哈希，真正的 `import()` 在点开那一屏时才发出，而 dev server 在按需编译 / 重建 / HMR 落盘之后，已渲染页面里那些哈希可能已指向**被换掉的旧分块**——请求到达时文件已不在，`import()` 只能 reject。刷新一下就好，但用户不知道要刷新。
  - 新增 `src/lib/shell/lazy-chunk-recovery.ts`：`isChunkLoadFailure()` 辨认四种固定形态（`ChunkLoadError` / `Failed to load chunk` / `Loading (CSS) chunk N failed` / `Failed to fetch dynamically imported module`），**不认**业务错误（刷新救不了它们）；`reloadOnceForChunkError()` 命中时整页刷新，且**只刷一次**（标记落 localStorage，跨刷新存活）——分块真的没了时第二次刷新同样拿不到它，没有这道闸就是刷新死循环，比一条报错更坏。生产构建不刷（那条路径该走「产物缺件」的显式暴露）。
  - `WorkspaceViewStack.tsx` 的 12 份 `next/dynamic` 声明**收进一个出口** `lazyView()`：漏一份，那一屏就仍是裸的（dev 重建后偶发，正常构建下完全看不出）。新增源码守卫 `src/components/studio/WorkspaceViewStack.test.ts` 钉住「只剩一处裸 `dynamic(`（出口自己那处）」。
  - 回归测试：`src/lib/shell/lazy-chunk-recovery.test.ts`（四形态辨认、不误伤业务错误、只刷一次、生产不刷）。
