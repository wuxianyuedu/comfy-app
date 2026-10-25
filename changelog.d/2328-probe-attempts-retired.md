## Fixed

- 首帧看护的「上限 × 间隔」那条用例不再断言已退役的 `PROBE_ATTEMPTS`：#2192 把首帧看护的
  预算改由 `poll_clock::PollClock` 以 `Duration` 持有，拍数不再是一个常量，而那条用例仍在
  断言 `PROBE_ATTEMPTS * PROBE_INTERVAL_MS` 的类型同档 ⇒ `typeOf` 抛错、用例**必红**。
  这条红躺在 master 上（`b69beea8` 改了 `src-tauri/src/lib.rs` 却没同步用例），
  把**每一个把 `src-tauri/**` 带进改动面的 PR**拦在「受影响用例」那一格外。
  用例改为钉**现行**形状：预算与间隔都由 `PollClock` 以 `Duration` 持有（跨类型相乘的余地
  由类型系统直接挡住）、退役符号不许回来、首帧看护函数体内不许再出现「两个常量相乘」。
  判据扫的是剥掉注释后的代码（注释里正当会出现「250ms × 480」这类退役前的叙述）。
