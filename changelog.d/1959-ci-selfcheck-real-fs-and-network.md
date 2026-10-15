## Fixed

- **两条判据自己发起真下载 / 真读盘 ⇒ 自托管节点上红成两种话术**（规范 §13.5.3.5.1
  第四类）：`installPython` 在一个 `run` 全报成功的世界里会**按序走完三条通道**，最后那条
  embed 通道默认真去 python.org 下载、真解压、真写盘，而两个「判到哪一步」的用例只注入了
  `findExe`。于是同一次运行里：
  `--scope user` 那条红成 `Test timed out in 30000ms`（下载 + 解压墙钟随网络走），
  而「两条 scope 都失败 ⇒ `installed === false`」那条红成 `expected true to be false`
  —— 节点上一次真下载把 `python-embeded/python.exe` 落进了检出，断言读到了**上一跑
  留下的目录**。处置是按「会不会碰外部世界」把接缝**列全**注入死（`run` / `findExe`）+
  `existing` / `download` / `unzip` / `mkdir` / `cwd`），收成夹具 `noExternalAction`；
  实测该文件从 **4040ms 降到 15ms**。
- **`e2e-fake-comfyui-endpoint` 的「关掉再起」自造竞态**：一条判「探到的形状归哪一档」的
  用例先关掉上一个 HTTP 服务、再起下一个，两次绑定之间没有任何东西保证新的监听已生效
  —— 自托管节点上实测红成 `expected 'free' to be 'real'`（`free` 就是 `status: 0`，
  也就是探针那一下没连上）。判「探到的东西是什么」不需要腾出端口：两个服务同时活着，
  `afterEach` 一起收。
