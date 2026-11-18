## Fixed

- **启动编排补上并发互斥：同一检出的编排器同时只允许一个进入起服务段**（ISSUE #4345）。
  此前两个 launcher 同时启动都会通过孤儿回收与端口检查并各自 spawn dev server；后到者的
  Next 在端口被占时按既有行为静默顺延 +1，而它的就绪探测打的是原端口——命中的是先到者
  的服务，「就绪」结论被冒领，两份编排日志 / 会话锚点指向不同进程。
  - 修法是会话锚点的**原子占坑**：`dev-launcher-session.mjs` 新增 `claimSession()`（`wx`
    独占创建 `run/launcher-session.json` + 触心跳），编排预检桥段（startup-gates 步骤 2.5、
    依赖补装之后 / 起服务之前）先占坑，占到才继续；占不到且 `isSessionOwnerAlive` 判上一位
    还活着 ⇒ 报「已有实例在运行（PID …）」退出；锚点在但上一位已死 ⇒ 清坑重占一次。
  - 排在依赖补装**之后**是契约：占坑即写会话锚点，而补装前的「实例在跑」判据
    （`runningAppInstances` 的 session 支路）会把自己当成已在跑的实例、误停补装。
  - 回归：`tests/cross-platform-launcher.test.ts` 互斥组（占坑三态 / 上位活着即冲突 /
    死锚清坑重占 / 无锚直占并落端口与模式）。
