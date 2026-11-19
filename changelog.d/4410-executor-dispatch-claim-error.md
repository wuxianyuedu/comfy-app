## Fixed

- comfyui 执行链：派发循环领取成功后的 `findExecJob` / `finalizeFailure` 补上兜错。
  此前这两处 reject 一次（SQLite busy 超预算、磁盘 IO），在飞槽位永不归还 ——
  常驻循环从此在 `pendingDispatch.size >= 1` 早退，reaper 又把该行当「仍被本进程
  认领」永久跳过，队列整体停摆，唯一恢复手段是手动取消或重启进程。现在领取后的
  段落包进 try/catch：失败留读数并摘干净内存足迹（`forgetTaskFootprint`），由
  reaper 下一轮接管 RUNNING 行，下一拍继续领取。（#4410）
