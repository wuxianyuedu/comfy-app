## Fixed

- 画布节点文件上传写错输入槽（#3900）：`onPick` 的完成回调读共享
  `uploadTo.current` 定写入槽——用户先给 firstFrame 选图（上传在途）、再给
  inputImage 选图时，ref 已被第二次 pickFile 改写，先发的上传结果落地写进
  错误槽位并随节点持久化。改为**发起时捕获**目标槽位，完成 / 失败回调一律
  写捕获值。
