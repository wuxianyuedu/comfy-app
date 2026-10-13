## Fixed

- **设置页「共享模型目录」不再对 ComfyUI 官方写法的 `extra_model_paths.yaml` 报「未配置」**。现场：用户实例的 `<ComfyUI>/extra_model_paths.yaml` 用的是官方示例那种「`base_path` + 段内 `名字: 相对路径`」（如 `checkpoints: checkpoints/`）与多行块（`text_encoders: |`）写法，而解析器只认 `paths:` 列表形式，于是把每段算成零条目 —— 日志里 ComfyUI 已经把共享目录（`D:\Comfy-Desktop\ComfyUI-Shared\models`）并进了各类型，设置页却说「未配置共享目录」。
  现在 `parseExtraModelPathsYaml`（`src/lib/comfyui/desktop-storage-paths.ts`）三种写法并列支持：段内 `名字: 相对路径`、`paths:` 列表、多行块标量（`|` / `>`）；`base_path` 与 `is_default` 仍按原语义处理，坏行与 CRLF 容错不变。回归用例覆盖三种形状（含真实子段的反斜杠 `base_path` 与无尾斜杠相对路径）。
- **新增 `--extra-model-paths-config` 候选来源**。ComfyUI（main.py:146 附近）用这个启动参数加载「共享模型目录」配置，Desktop 版也可能走这里而不是默认的 `extra_model_paths.yaml`。`resolveDesktopStoragePaths` 现在解析该参数指向的文件（支持 `--x <值>` / `--x=<值>` / nargs='+' 多个值），逐份解析并与主 yaml 叠加；文件缺失按「没有这一份」处理。解析纯函数 `parseExtraModelPathsConfigArgs` 同文件新增，判据单测钉死。
