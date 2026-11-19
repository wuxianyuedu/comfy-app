## Fixed

- **本机 JSON 配置的「读-合并-写」并发互踩收口**（ISSUE #3859）：工坊 ComfyUI
  通道设置（`data/workshop-comfy-settings.json`）、尺寸配置表覆盖
  （`data/size-presets.json`）、工坊模式契约覆盖、侧栏页签行为覆盖——这四处的
  「读基准 → 合并/差集 → 整份写回」现在先进进程内互斥串行化，写盘改 tmp + rename
  原子替换：并发保存不再以旧快照互相覆盖丢字段，读侧也不会撞到半截 JSON。
  与已修的 `app-settings` / `api-channel`（PR #3845）同一口径。
