## Fixed

- **三组「唯一出口」被绕过的重复实现收口（§12.18 / 硬规则 20）**：
  - `readFileAsDataUrl`：`file-io` 与 `browser-io` 各有一份、语义漂移（空文件一个抛错一个 resolve 空串），调用方分裂。删 `browser-io` 版并把它的 SSR 守卫并入 `file-io` 唯一出口，`use-dynamic-workflow-form` / `EncapsulationTestForm` 两个调用方迁 `file-io`。
  - `randomSeed`：地基 `random-seed.ts` 头注释点名要收的 `raw-overrides.ts` 逐字副本仍在（未迁），视图层 `ShotStudio.tsx` 又内联两遍 `Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)`。三处一律 import 唯一出口。
  - `sleep`：`lifecycle-wait.ts` 与 `run-engine.ts` 各写一份 `new Promise((r) => setTimeout(r, ms))`（`with-timeout.ts` 头注释称收口前有 15 处）。两处改 import 出口；`lifecycle-wait` 那份 `export`（零外部消费）一并删除。

复扫确认：`src` 内 `Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)` 与 `new Promise(...setTimeout...)` 型 sleep 副本除唯一出口外清零。
