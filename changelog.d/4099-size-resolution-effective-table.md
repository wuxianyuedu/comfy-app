## Fixed

- **「尺寸 · 分辨率档」端口的档位反解改读生效表**（#4099，#3972 的遗留半边）：
  正向换算（尺寸表达 → WxH）在 #3972 已改读生效表，但映射层把 WxH 反解成
  档位（`sizeValueForPin` 的 `size-resolution` 分支 → `resolutionTierOf`）
  仍按编译进包的默认表比对 —— 表被改大后（如 16:9 1k → 1920×1080），WxH
  会被反解成 `2k`，写进分辨率 COMBO 端口后 ComfyUI 静默回落。现在
  `applyParamMapping` 接受可选 `table` 并传到反解分支：`buildEncapsulatedInputs`
  把自己手里的生效表传下去，画布就地运行（`generate-payload`）与工作流库
  就地运行（`use-generation-runner`）传客户端水合表；不传表回落默认（不劣化）。
