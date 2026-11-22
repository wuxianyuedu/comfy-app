## Fixed

- **消息中心模块级监听器改为可重入注册，dev HMR 重求值不再叠加（#4729，
  #3897 的子项）**。`message-center-store` 的 `window` storage 监听器与
  zustand 订阅挂在模块体且无摘除路径：Turbopack dev 热重载重求值该模块时
  逐次叠加（合并逻辑按 id 去重，后果仅是重复执行，但属监听器无界增长）。
  现在先摘旧再挂新，摘除凭据挂 `globalThis`（HMR 单例，同 `queue-signal`
  的做法）；生产环境只求值一次，行为不变。回归用例重求值模块后断言
  「旧监听器被摘、新监听器就位」。
