## Fixed

- 自主 run 的成片等待预算不再固定 300 拍（#5142）：改为 `filmWaitTicksFor(shotCount)`
  = 底仓 240 + 每镜 600 拍，与成片监看侧同一份换算（共用 `lib/film/film-wait.ts`）；
  多镜头片子还在正常生成时不再被判「成片等待超时」。补预算换算与脏值防御用例。
