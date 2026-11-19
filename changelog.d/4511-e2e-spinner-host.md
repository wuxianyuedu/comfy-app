## Changed

- **e2e：转圈形状守卫换宿主**（配套 #4511 的加载态骨架化）：ISSUE #720 的
  spinner 形状判据（真圆不是竖线、尺寸不靠调用处布局撑着）原以工作流库首次
  载入的 `PageLoading` 为宿主；#4511 起该处改为骨架占位、不再有 spinner。
  守卫换到设置页首屏加载的 `PageLoading`（同一个 `ui/spinner` 出口），判据
  一字未改；宿主切换用 `setting.get` 延迟拖住 `isInitialLoad`。纯测试改动，
  无用户可见行为变化。
