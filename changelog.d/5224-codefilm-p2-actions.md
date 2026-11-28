## Added

- 代码驱动影片 P2（#5224）：新增打斗动作库（6 个内置招式 charge/punch/dodge/impact/knockback/sweep，
  声明式关键帧、非可执行代码）；`actionBeats` 可引用招式或给自定义关键帧；新增全局关键帧展开器，
  把镜内相对秒折算成全局帧号（one map and one clock）；QA 追加招式引用 / needsTarget / 跨镜时序单调校验；
  展开后的关键帧写入 `Shot.params` 与生成提示词。P0/P1 的自由文本节拍保持兼容。10 条新用例覆盖展开、
  连续性、兼容性与翻译接线。
