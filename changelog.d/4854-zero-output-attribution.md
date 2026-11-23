## Fixed

- **「无输出内容」失败可归因了**（#4854）：两阶段工作流的文本子图耗尽生成预算
  （thinking 顶满 max_length）后，图像分支被开关节点**静默短路** —— ComfyUI 报
  completed、无任何执行错误，收口此前只给一句泛化的「无输出内容」。现在收口用现场
  已有的信号归因：执行图里的输出类节点（SaveImage / SaveVideo / …）一个都不在
  history.outputs ⇒ 点名「输出节点均未执行（图像分支可能被开关节点短路）」；任务
  日志里有节点进度已跑满仍无输出 ⇒ 点名节点与进度（如 TextGenerateV2 8196/8196）
  并提示检查 max_length / thinking / 提示词。证据不足时仍如实报「无输出内容」。
