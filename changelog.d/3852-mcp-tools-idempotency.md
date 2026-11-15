## Fixed

- **MCP 工坊工具族补上幂等闸**（ISSUE #3852）：
  - `workshop_submit_video`：镜头已有产物（done 的 url）或在跑的异步任务
    （`task:` 前缀）时，重试 / 二次指令直接返回既有引用——不再重复提交外部
    计费调用、不再用新任务句柄覆盖旧的（旧的将无法轮询取回）；显式
    `force=true` 才重跑。
  - `workshop_create_session`：按参数指纹 5 分钟窗口内去重——超时重试 / 同一
    指令二次调用返回既有会话，不再重复建「会话 + 项目 + production」三件套
    （命中会复核会话仍在，消失即重建）。
  - `workshop_generate_script` / `workshop_extract_characters` /
    `workshop_build_storyboard` / `workshop_generate_image`：已有剧本 / 角色卡 /
    分镜 / 镜头图片时默认直接返回既有内容，`force=true` 才重跑外部调用。
  - `updateState` 的「读会话行 → 遗留行补建项目 → 写 production → 写会话行」
    整段收进 `immediate` 事务：并发 MCP 调用不再以各自 `load()` 的旧快照互相
    覆盖、不再重复建项目。
