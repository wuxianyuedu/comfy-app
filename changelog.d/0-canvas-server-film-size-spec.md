## Changed

- **画布节点 / 服务端工坊 / 短片项目的尺寸也统一到尺寸表达**（上一轮把 `lib/size-presets` 定为唯一出处，本轮收掉剩下的三处 "WxH" 字符串口径）：
  - **项目画布节点**：`CanvasNodeData.size` 由 `"1024x1024"` 字符串改为 `SizeSpec`（默认图片 1:1 1k、视频 16:9 1k，都查尺寸表）；画布专用的写死候选表 `IMAGE_SIZES` / `VIDEO_SIZES`（零引用死代码）删除。旧 localStorage 数据里的字符串由 `toSizeSpec` 归一。
  - **服务端工坊通道**：`orchestrator.GenerateImageInput.size`、`generateImageViaComfyUI`、`buildTxt2ImgWorkflow` 改吃 `SizeSpec`，内置 SDXL 图的宽高由图片场景尺寸表现算；上游 `images/generations` 只认 `"WxH"`，在**外部 wire 边界**折算（`sizeSpecToWxH`）。MCP 的 `workshop_generate_image` 新增 `ratio` / `clarity` / `multiple` 入参（两种类别任选其一），老的 `size` 字符串参数保留为兼容入口、由边界归一。
  - **短片项目**：成片画幅列改为存尺寸表达 JSON（老行里的 `"1280x720"` 由 `toSizeSpec` 兼容读，无需迁移）；默认值与 ffmpeg 的 `scale/pad` 都从视频场景尺寸表现算（`lib/film/film-size.ts` 的 `FILM_COMPOSE_SIZE`）。单镜视频默认分辨率保留 **832×480**（Wan 等视频底模的原生输入规格，不是尺寸档位，显式注明）。
- `size-presets` 新增两个容错入口：`toSizeSpec`（`SizeSpec` / 旧 `"WxH"` 字符串 / 未知值 → 合法尺寸表达）与 `normalizeRatioLabel`（短比例标签 `"16:9"` → 预设行 `"16:9 横屏"`）—— 外部调用方按直觉给的写法不再被静默回退成默认比例。
