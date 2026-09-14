## Changed

- **视频「时长」口的值真正落到本地生成链路**：`WorkshopExposedValues` 新增 `duration`（秒）与 `frames`（帧），`classifyWorkshopPin` 认「时长」口（duration / length / num_frames / frames / 帧数 / 秒数，先排掉 fps），取值按落点端口自己的单位给 —— 按帧表达的端口吃 `frames`，按秒表达的吃 `duration`（两者都由调用方按当前 fps 折算好，封装层不猜 fps）。`VideoStudio` 选工作流库工作流时把 `shot.duration` 与 `framesFor(shot, fps)` 一并传下去，`buildLibraryWorkflowInput` 把帧数并进 `frames` 字段。此前「时长」口能配落点、但值从来没下发过，工作流一直吃自己的默认帧数。
- **「画布节点」页签的对外参数卡片与「工坊封装」页签口径统一**：卡片头在参数名后跟上契约口 id（「提示词 `prompt`」「尺寸 `size`」「参考图 2 `reference-image-2`」…），与封装页签同一套写法。契约口与适配器口是两套 id，界面上只有中文时对不上配置、日志与代码。
