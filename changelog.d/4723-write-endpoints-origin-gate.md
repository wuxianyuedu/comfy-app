## Fixed

- **跨站「简单请求」写面补齐同源闸（#4723，#3904 的子项）**。`multipart/form-data`
  POST 与带查询串的 DELETE 属 CORS 简单请求、不经 preflight，恶意网页可对本地服务
  盲发写请求；而本机单用户模式下 `requireRequestUser()` 恒回落演示用户放行，鉴权层
  不构成边界。同源闸此前只在 `schema/push` 一处实现（#4040），现收口为共享出口
  `~/server/lib/same-origin` 的 `rejectCrossOriginWrite()`，并接入**全部 27 个**
  含写方法（POST/PUT/DELETE/PATCH）的 REST 路由（缺 Origin 的本机工具照常放行）。
  新增门禁 `check-write-origin-gate.cjs`（硬闸）：带写方法的路由不过同源闸即阻断，
  防后续新增写端点漏挂。
