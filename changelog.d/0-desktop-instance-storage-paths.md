## Added

- 设置页「创作后端」在桌面版实例下新增**实例目录（只读）**区块：直接显示模型目录、
  共享模型目录、输入 / 输出目录与共享输入 / 输出目录各指向哪个盘符，并标出被
  `--base-directory` / `--input-directory` / `--output-directory` 覆盖的那几条与
  「目录不存在」的目录。数据取自实例根布局、`extra_model_paths.yaml` 与 ComfyUI
  Desktop 元数据里的启动参数——此前应用只能给出模型目录**名**（`GET /api/models`），
  绝对路径要去 ComfyUI Desktop 自己开「存储」页看。