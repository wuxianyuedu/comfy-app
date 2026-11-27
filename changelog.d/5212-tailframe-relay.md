## Added
- 跨镜首尾帧接力（ISSUE #5212，借鉴 LocalMiniDrama / MiniMax H3 Director）：`Shot.continuityFromShotId` 指定上一镜，建片时带上其 `clipUrl`，生成前用 ffmpeg 从片段尾部抽一帧（`tail-frame.ts`）覆盖首帧；抽帧失败 / 上一镜无片段时回落定稿图，不阻断生成。补 ffmpeg 参数形状与来源识别用例。
