## Fixed

- **视图层 3 处状态色走语义 token**（P79 首批 · 累计 67 → 64）：
  `studio/history/history-types.ts:38-41` 的 `dotCls` 里 SUCCEEDED /
  RUNNING / FAILED 三档状态色，从 `bg-emerald-400` / `bg-violet-400` /
  `bg-red-400` 换成项目「统一状态映射」的语义 token
  `bg-success-strong` / `bg-primary` / `bg-destructive`（对齐 §3.6.2
  与 `globals.css`；见 MEMORY「QUEUED→info · RUNNING→primary ·
  SUCCEEDED/DONE→success · FAILED→destructive · CANCELLED→warning」）。

  视觉会略漂（emerald-400 浅薄荷 vs `--color-success-strong` #10b981
  深一档），语义一致性优先。用户口径「允许视觉漂移、后续再处理」。

  CANCELLED 仍留 `bg-gray-400`——**语义上应对 warning**（琥珀），但灰→琥珀
  是**跨色系**跳、不是同色系深浅档；这类需要产品视觉走查、留下一批
  统一处理。

  基线 **71 → 68**。
