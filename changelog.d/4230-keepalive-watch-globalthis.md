## Fixed

- 保活退出监督器 `keepAliveExitWatcher` 是模块级变量，dev 热重载后旧监督器的 interval 还活着、新实例看到 null 再挂一个——双监督器并存、退出横幅可能双发（#4230；同文件其它跨 HMR 单例都挂 globalThis，唯独它漏了）。迁到带版本号的 `globalThis.__comfyKeepAliveWatch_v1`（与 lifecycle.ts / runner-state 同款写法）。源码形态钉在 tests/keepalive-watch-singleton.test.ts（无运行期入口）。
