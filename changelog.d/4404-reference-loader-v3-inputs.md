## Fixed

- 参考图装载预设：识别 ComfyUI V3 新输入形状，装载链控件值出下拉（#4404）。
  `ResizeImageMaskNode` 等新节点的 `scale_method`（候选在 options 键的 COMBO）与
  `resize_type`（`COMFY_DYNAMICCOMBO_V3`，候选 = 选项 key）此前归一不出候选，
  编辑器退化成自由文本框；`input`（`COMFY_MATCHTYPE_V3` 连线口）被误判成部件，
  导致 `chainResolvable` 恒假——整条链执行期静默回落裸 LoadImage，预设根本没生效。
  现在部件/连线判据与 comfy-cli 转换器对齐：候选出下拉、动态 COMBO 按选中项展开
  子输入（点号键存值、API 图按后端 `finalize_prefix` 的官方线格式提交）、
  MATCHTYPE 出口可当 MASK 出口、MASK 目标首跳喂 LoadImage 的 MASK 口；
  选中项带连线型子输入的端点整链回落裸装载，不再产生必然被后端拒绝的图。
