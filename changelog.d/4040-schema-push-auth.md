## Fixed

- **`POST /api/schema/push` 补鉴权与同源闸（#4040）**：该端点会以 `--force`
  口径 spawn schema 同步（含删列 / 重建表这类会丢数据的语句），此前无鉴权、
  无同源校验、不读 body、不带自定义头——属于 CORS「简单请求」，用户开着应用
  时任意网页可静默跨站触发。现在要求登录用户（`requireRequestUser`），且
  `Origin` 必须是本机界面同源或启动页那一族（白名单唯一事实源
  `~/lib/shell/splash-origin`，与 `/api/health` 同一清单）；缺 Origin（本机
  工具 / curl）放行。接口契约与兼容审计 #3907 的 P1 项。
