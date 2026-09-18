## Changed

- **工坊封装也改为「只认作者连的线」**（用户口径：「工坊封装都靠手动连线，不靠名字约定」）：`buildEncapsulatedInputs` 不再自己按 pin 名 / 节点类名猜槽位，而是把工坊的对外值翻译成**契约口 id → 值**，交给映射层（`applyParamMapping`）落到作者连过线的端口上 —— 与「画布节点」页签的就地运行、与封装状态派生（`workshop-encapsulation-status`）走同一份映射。新增 `paramMap` 入参：客户端链路传 `detailFull.paramMap`，服务端编排传 `tpl.paramMap`。
- **删掉整套名字启发式**：`classifyWorkshopPin` / `classifyVideoPin` / `WorkshopPinClass` / `VideoPinRole`、`isImagePin` 的名字正则、`isFirstFrameClass` / `isLastFrameClass`（`LoadImageFirstFrame` 这类类名判定）、`isWidthPin` / `isHeightPin` / `isAspectPin` / `isMegapixelsPin` / `isMultiplePin` / `isPromptPin` / `isNegativePin` / `isDurationPin` / `isFpsPin` / `isFramesPin` 一律删除 —— 猜错的时候用户无从察觉（库里的线说连的是这个口，工坊却按名字把值落到别处）。
- **`WorkflowIOEntry.classType` 连根删除**（服务端富化与客户端 IO 编辑两处写入点、两处类型定义、各测试夹具与用例）：它的唯一用途就是给工坊判「首帧 / 尾帧 / 普通参考图」。节点类名在服务端仍作为查 `multiline` 声明的**内部**键保留。
- 工坊**不再下发未连线的口**（以前会把每个被识别 pin 的工作流默认值都塞进载荷）：没连线就是「未配置」，工作流图内自带的值照旧生效；无消费方的 `EncapsulatedInputs.exposed` / `internalKeys` 随之删除。
- 上报口径收敛：尺寸的子口级失败折叠成一条 `size`（工坊只送一个尺寸表达，接住其中一路即算接住）；图片 / 时长在**模式契约压根没有这个口**时补报（T2I 收到参考图不再静默丢掉）。时长仍按**落点端口**自己的单位取 `frames` / `duration`，COMBO 候选照旧收敛。
- 回归用例重写为「每条落点都先给一条作者连线」：两行同名 `text` 靠线分清正负、两个同名 `image` 上传口靠线分清首尾帧、镜头图落首帧口、未连线 / 显式断开 / 端口已消失如实进 `unmatched`、尺寸按子口身份派形状、时长单位与候选。名字启发式那组用例随实现一起删除。
