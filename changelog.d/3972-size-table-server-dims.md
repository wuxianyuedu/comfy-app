## Fixed

- **设置页「尺寸配置表」改动后，服务端出图按生效表换算宽高**（#3972）：
  此前「生效表」（项目默认 + 本机覆盖）只在客户端链路（`/api/size-presets` →
  `size-preset-store` → 各尺寸控件）生效，服务端换算走纯函数层的默认参数 ——
  编译进包的 `DEFAULT_SIZE_PRESET_TABLE` 快照。表现为：把 16:9 的 1k 从
  1024×576 改成 1280×720 后，界面显示 1280×720，而下发给 ComfyUI 的仍是
  1024×576。现在出图链路的每一处换算都喂同一份生效表：
  - 读取侧拆出 `size-preset-fs.server.ts`（不带 `server-only`，MCP stdio 等
    纯 Node 宿主可安全引入），`loadSizePresetTable()` 为读侧唯一实现；
  - 工作流库封装（`buildEncapsulatedInputs`，客户端 `generation-client` 传
    水合后的 store 表、服务端 `workflow-run.server` 现读生效表）；
  - 工坊编排 api 通道（`orchestrator.generateImage`）与 comfyui 通道
    （`generateImageViaComfyUI` → `buildTxt2ImgWorkflow`）；
  - 角色定妆照远端通道（`character-portrait-client`）、成片合成画幅
    （`compose-film`）、成片 ffmpeg `scale`（`final-compose`，改为合成时现读，
    不再在模块加载时算死）、MCP 老口径尺寸反解（`workshop-mcp`）。
