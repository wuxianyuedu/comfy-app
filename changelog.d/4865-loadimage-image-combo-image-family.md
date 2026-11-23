## Fixed

- 连线类型闸门不再拦住 LoadImage 的「图像」文件选择器（#4865）：`image` COMBO 部件的候选就是已上传文件名，是**真正的图片落点**——但此前它按 COMBO 归进数值族，参考图 / 首帧槽位拖到它上面被「类型不同」拦下；反而是无用的 `upload` 上传按钮（IMAGEUPLOAD）能连（值到不了 ComfyUI，见 #4862）。现在富化条目随带节点类名（`classType`），`pinFamily` 对 LoadImage 的 image COMBO 按图片族对待——作者可把参考图 / 首帧槽位连到真正的文件部件上，覆盖值走既有部件覆盖链路生效。其余 COMBO（采样器 / 宽高比等）仍归数值族，不放松。
