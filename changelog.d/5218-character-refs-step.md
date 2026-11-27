## Added
- AI run 角色定妆照步骤（ISSUE #5218，借鉴 NovelVids / LocalMiniDrama 的角色设定图锚点）：`extract_characters` 后新增可选 `render_character_refs`，复用图类工作流按角色卡提示词出一张参考图并回写候选与 `portraitUrl`；单角色失败只记日志不阻断剧本/分镜，`characterRefsDone` 防失败时无限重出，`skipCharacterRefs` 可跳过。补规划器与执行器用例，100 条相关用例全绿；产品阶段②口径同步更新。
