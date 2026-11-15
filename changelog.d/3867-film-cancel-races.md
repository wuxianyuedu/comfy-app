## Fixed

- 成片生命周期取消路径并发缺口（#3867，审计源 #3848）：startFilm 逐镜提交每轮重读影片状态，取消后剩余镜头不再提交；markQueued 失败补偿取消已建任务；watchFilm 改「等旧循环退场→重读状态→仍 GENERATING 才起新循环」的交接语义；claimComposing 排除集补 CANCELLED/FAILED；markDone 加非取消终态守卫；cancelFilm 两步写收进 immediate 事务；watchLoop 续写进度前重读影片状态。
