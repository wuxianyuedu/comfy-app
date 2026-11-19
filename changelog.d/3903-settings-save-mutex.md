## Fixed

- 设置页即时自动保存无串行化（#3903）：快速连改两个字段时两次保存重叠在途，
  HTTP 不保证先发先至——旧草稿后到覆盖新值并经 refetch 播种回界面（「保存了
  却没生效」），saving 布尔位还被先完成者提前复位。两个保存出口
  （persistLlmDraft / savePrefs）收进同一把 `AsyncMutex` 按发起顺序落库；
  saving 改按在飞计数熄灭。
