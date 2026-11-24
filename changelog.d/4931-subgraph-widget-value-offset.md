## Fixed

- **工作流编辑器：子图封装节点的 widget 值从 seed 后整体错位一位**（#4931）：
  `Image to Video (MiniMax H3)` 这类只暴露 seed、不暴露其随机化控制的子图封装节点，
  `widgets_values` 里没有 `control_after_generate` 哨兵槽，而两条「widget 名 → 值」
  配对路径（子图解析的 `pairWidgetValues` 与 detail 的 `buildRawInputs` legacy 游标）
  都在 seed/noise_seed 后**无条件**多跳一格 ⇒ 画布从 `unet_name` 起全部显示成后一位
  的值（`unet_name` 显示成 `clip_name` 的模型名、`audio_vae` 显示 ×、`turbo_steps`
  落空）。改为按 `widgets_values` 长度自适应判定哨兵槽是否存在（与
  `mapWidgetValuesByOrder` / `hasSeedControlSlot` 同口径），长度都对不上时保持原行为。
