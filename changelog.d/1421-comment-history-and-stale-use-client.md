## Removed

- **注释里的「迁移流水」就地清理（规范 §12.4.2）**：55 个文件头原本写着「这段代码曾经在哪、从哪个文件搬过来、拆出时主文件多少行」—— 这类信息 `git log` / `git blame` 全都有，写进注释只会随代码搬迁过期失真。逐处删掉出处句（`从 X 抽出` / `原本内联在 Y 里` / `P3 迁移第 1 期` / `batch 4` / `拆分动机：主 hook 曾 900+ 行`），**保留**每处紧跟其后的当下判据（依赖方向、断环理由、契约不变、为什么必须留在叶子层）。
- **5 处名不副实的 `"use client"`**：`workflow-render-chain.ts` / `canvas-render-chain.ts` / `workflow-node-palette.ts` / `log-panel-selection.ts` 是纯函数模块（无 JSX、不 import react），只被客户端组件消费；`use-settings-page-types.ts` 更是**服务端可达**的类型与常量叶子 —— 它的 `"use client"` 是条假声明（服务端消费者引它时会被拖进客户端图）。去掉指令后这五个文件照旧随消费方进客户端包，行为不变（`scripts/lib-node-only-scan.mjs` 与 `tests/single-logger-channel.test.ts` 都复跑为绿）。

> 判据与边界：`src/lib/**` 里那批 `"use client"` **不动** —— 按 §18.4 / §18.13.3 它是「客户端侧模块」的正式声明，其中 `generation-client.ts` / `sync-notice.ts` 还被日志唯一通道的豁免清单逐条点名要求首行必须是指令。同名兄弟的 barrel（`CanvasNode/index.tsx` 等）也不动：它们重导出的叶子（如 `CanvasNodePrimitives.tsx`）自己不带指令，barrel 就是那条边界。
