## Fixed

- **workflow 的 resync / updateFromJson / delete / convertToOnline 收进同一把按模板
  id 的 keyed mutex**（#4460）：此前后两个「读 existing → remap → 落库」入口不持锁，
  与 update 并发时会用旧读数把刚保存的参数 / 连线覆盖回旧值（丢更新）。
  resync 的慢 IO（读磁盘 / checksum）留在锁外，进锁后重读 existing 再做连线保持；
  delete / convertToOnline 复用同一把锁与进行中的读改写互斥。补并发用例钉住
  「第二笔的重读排在第一笔落库之后」。
