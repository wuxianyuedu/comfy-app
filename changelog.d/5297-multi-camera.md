## Added
- 机位覆盖生成（ISSUE #5297，借鉴 Higgsfield「先基础动作、后补机位」）：镜头新增 `coverageFromShotId` / `coveragePreset`（wide / low / foreground）；建片时把基础动作片段与机位预设落进镜头参数，生成时从基础片段抽末帧作视觉锚点并把机位约束接在提示词后，保留站位/动作方向/抓握/服装；顺序不对只记 warn 不阻断，与 #5212 尾帧接力分工明确。补 6 条纯函数用例，产品口径同步更新。
