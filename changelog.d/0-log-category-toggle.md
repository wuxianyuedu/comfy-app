## Added

新增「日志分类开关」（设置 → 日志）：可逐类开启 / 关闭日志面板的显示，支持动态切换、无需重启。

- 在设置页新增「日志」分区，对每一类日志来源（应用运行 / 应用服务 / 启动 / 启动器 /
  控制台·全局错误）提供一个开关。
- 关闭某类后，该类日志在日志面板里**不再显示**（仅隐藏显示，`log/` 下的真实文件照常写入），
  按来源筛选时也会跳过被关掉的分类；计数维度不读开关，下拉仍显示各类真实条数。
- 开关状态记忆在浏览器 localStorage（纯前端偏好，不写后端设置），默认全部开启。
- 面板实时跟随：设置页改开关即生效，无需重开面板（基于 `useLogCategoryStore` 的订阅联动
  `log-store` 重新计算 `filteredLogs`）。

涉及文件：`src/app/(main)/settings/*`（分区与侧边栏入口）、
`src/components/studio/logs/log-category-store.ts`（开关状态单例 + 持久化）、
`src/components/studio/logs/log-analysis.ts`（`computeFiltered` 增加 `disabled` 参数）、
`src/components/studio/logs/log-store.ts`（订阅开关联动重算过滤结果）。
