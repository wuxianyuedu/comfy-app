## Fixed

- **又一条形如「判据在 POSIX 绿、在 Windows 恒红」的门禁自测**：`tests/shell-gate.test.ts` 那条「PATH 上有一份 cargo 时**用它**，不许越过它去挑安装位里的」在本机 100% 红，而红的不是优先级判据，是夹具 —— 它给 PATH 目录写的是 `#!/bin/sh` 脚本。这里有一处不对称：`findCargo()` 的**安装位那几支只查「那条路径在不在」**，而 **PATH 那一支走 `whichCommand()`，它会真起一次确认**（`spawnSync` + `--version`）。Windows 上 libuv 不解析 shebang（CreateProcess 直接拿路径），于是那份永远被判「起不来」，判决落回假 home，红看起来像「PATH 优先没生效」—— 而它确实是没生效，只不过是被夹具挡住的。
  修法不给壳门禁脚本的 `findCargo()` 开注入参数（那等于为了测试改产品面，而这一格想判的恰好是「真机器上 PATH 那份会不会被优先采用」）：win32 档借当前宿主 `copyFileSync(process.execPath, …)` 造一份真能 spawn 的 PE（实测本机一次复制 40 ms / 89 MB，摊进提交门槛可以忽略），POSIX 档照旧写脚本 + 执行位。判据一条没放宽：把 `if (onPath) return onPath` 短路掉，**恰好**这一条红（串行单跑复核）。同族上一次收口是台账 E12（`executable-resolve` 的 POSIX 那几档），那批留的口径是「能注入的一律注入」—— 本条是它的反面案例：**注入点在产品侧不存在、而想判的正是真机器行为时，该修夹具而不是开缝**。
