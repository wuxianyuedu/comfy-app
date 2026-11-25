## Fixed

- 日志分类开关 store 改为水合安全：创建期不再读 localStorage（首帧与服务端同值、全开），自定义开关在日志面板挂载后由 `hydrate()` 恢复——消除「设置 → 日志」改过开关的用户撞上 React 水合不匹配的隐患（与 message-center 同族坑，#5011）
