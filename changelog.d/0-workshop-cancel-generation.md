## Added

- **工坊生成可取消**：镜头生图与视频生成阶段，进行中的本机任务行内出现
  「取消」按钮（`src/components/workshop/ShotStudio.tsx` /
  `VideoStudio.parts.tsx`）。点击经控制器 `cancelShotTask` 调 tRPC
  `task.cancel`（新增 `cancelLocalTask` 出口），任务置 CANCELLED 后由既有
  观察循环收终态：状态回 `failed`、提示「已取消，可重新生成」——用户主动
  取消不再被报成红色「生成失败」。API 直连任务没有本机任务 id，不提供取消。
