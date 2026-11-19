## Fixed

- 模型库把 Custom Nodes 的插件源码当模型收进库（#3368）：ComfyUI 的目录清单含
  custom_nodes、目录文件列表又是全量递归——补两道收录判据：非模型用途目录
  （custom_nodes）整目录排除（同步与目录列同刀）；目录内文件按模型扩展名
  （safetensors/ckpt/pt/pth/bin/gguf/sft/onnx/engine/trt）过滤，过滤后没剩文件的
  目录不落库、从目录列消失。
