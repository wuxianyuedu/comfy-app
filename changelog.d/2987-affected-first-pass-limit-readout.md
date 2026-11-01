## Fixed

- **「受影响用例」掐断那一屏念的预算数比真实掐点还大**：`runChunk` 把同一个数算了两遍——`spawnVitest` 拿到的是「剩余 − 30s 收尾余量」，而掐断时那句「剩余预算 N 分钟」漏了这笔扣减。于是 build `cnb-pl9-1k6b45aqm` 的 stage-9 掐在 24.5 分钟，日志写的却是「剩余预算 25 分钟」，而这个数正是读的人用来判「这一格装不下 / 刚好差一点」的唯一读数。两个数各算一遍时漂开没有任何一格会红。
- 修法：上界收成一处 `firstPassLimit()`（`affected-launch-wallclock.mjs`，与 `firstPassTimeoutReserveMs` 同住），提交给 vitest 的 `timeout` 和掐断那一屏念的是**同一个值**；`fmtMinutes()` 与收尾那份账共用一档写法，「没设界」不许念成 `0 分钟`。
- 同一屏那句下一动作也不再一律归到「拆小」：清单只有百来份却掐断，多半是共享节点把 `--maxWorkers` 压到 1~2（`ci-load.mjs` 按 `CNB_CPUS` 折算），拆开改动买不到任何东西——实测同一份 155 份清单在本机 3.5 分钟跑完。两档都点明不许用 `COMFY_AFFECTED_WALL_CLOCK_MS` 调大界来「换绿」。
- 判据：`tests/hook-affected-launch.test.ts` 新增四条钉住「上界 = 剩余 − 余量 / `null` 不落成 0 / 下界 1 / 读数写法」。

  > 本 PR（#2987）那一格的红就是**装不下 + 机器被占**，不是代码回归：155 份 / `--maxWorkers=2` 在节点上跑不完 25 分钟预算，同一份清单在本机 8 核 `--maxWorkers=8` 是 3m28s，7 条失败全是 Windows 盘符断言（`isSameVolume("G:\\a","C:\\b")` 一类）在 Linux 上的平台形态，`node scripts/base-check.mjs` 在 `origin/master` 上同样命中。
