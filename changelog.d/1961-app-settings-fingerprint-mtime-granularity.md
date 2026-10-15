## Fixed

- **那条缓存用例把「跑判据那台宿主的 mtime 刻度」写成了恒真性质 —— 平台侧一直红**
  （ISSUE #1961，又一次「本机绿、节点红」）。

  读数（`cnb-60n-1k50qev62`，`单元测试` **9455 passed / 1 failed**）：

  ```
  FAIL src/lib/app-settings/app-settings.server.test.ts > getSettingsSync 的跨进程失效
    > 指纹没变时走的是同一份缓存对象（不是每次都重读）
  AssertionError: expected 'A' to be 'B'
  ```

  那一条先写 `{comfyCliPython: "A"}`、再写 `{comfyCliPython: "B"}`，指望两次写盘的
  **指纹不同**（`getSettingsSync()` 的失效判据是 `mtimeMs:size` 二元组）。而
  `"A"` 与 `"B"` **长度一样**：两次 `writeFileSync` 连着跑，只要落在同一个 mtime 刻度上，
  指纹就**真的没变** —— 缓存于是**正确地**返回旧值，而这行读取被读成「缓存没失效」。

  本机（ext4，纳秒 mtime）两次写盘的 mtime 几乎必然不同 ⇒ 恒绿；平台侧那台
  Windows 节点上刻度粗 ⇒ 撞上同一格。**判据把宿主时钟/文件系统的刻度写成了恒真性质。**

  修法：第二次写盘换成**长度不同**的值（`"A"` → `"BB"`）—— `size` 必然不同，
  与 mtime 刻度无关；而这一格要判的东西（指纹变了就重读）一件没松。

  反向复算（把 mtime 冻结成同一个值，即 Windows 上撞刻度的形态）：`"B"` 的指纹与
  `"A"` **相同**（旧断言当场不成立），`"BB"` 的**不同**（新断言成立）。
