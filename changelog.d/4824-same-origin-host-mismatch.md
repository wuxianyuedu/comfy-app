## Fixed

- **桌面壳内所有写端点被同源闸误杀**（#4824，#4804 落地的回归）：启动后控制台
  报「尺寸配置表保存失败（HTTP 403）」—— 壳页面源恒为 `http://127.0.0.1:<port>`
  （shell_launch 的导航 URL），浏览器对同源写请求必带同值 Origin，而
  `same-origin.ts` 的同源判据挂在 `new URL(request.url).origin` 上 —— Next 会把
  `request.url` 的 host 改写成与请求无关的内部值（实测 dev 下是
  `localhost:<port>`），同源 Origin 对不上即被拒。curl 探针复现：
  `Origin: http://127.0.0.1:3797` → 403、`Origin: http://localhost:3797` → 200
  （读数与直觉相反，正是改写造成的）。修法：判据改用 `Host` 头拼「本请求的源」
  与 Origin 比较 —— Host 是请求实际打到哪的唯一事实，跨站盲发的 Origin 是
  攻击者自己的源、不可能等于本机 Host，判据强度不变；splash 名单与缺 Origin
  放行两条不变，`Origin: null` 字符串形状维持拒绝。判据单测
  `src/server/lib/same-origin.test.ts` 同批更新到 Host 口径并钉住八种形状
  （含壳同源这个回归主形状）；`AppShell` 函数因 #4817 的右键菜单越过 400 行
  函数闸，同批按职责把「项目」分组拆成子组件 `SidebarProjectsGroup`（§12.13）。
