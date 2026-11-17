## Added

- **ComfyUI 拉起前的「源码 ↔ 运行环境依赖脱节」预警**（#4192）：
  源码被升级而运行环境的 Python 依赖没跟上时（实测：comfy-aimdo 源码侧要 0.6.0、
  环境里还是 0.5.6，生成期报 `ModelVBAR ... unexpected keyword argument 'pageout_callback'`），
  应用此前要等到节点执行期才看到一句难懂的 Python TypeError。现在 `runEnsureLaunch`
  在 spawn 之前只读核对源码 `requirements.txt` 的 `==` 锁包与所选解释器 site-packages
  的 dist-info 实际版本，差异面逐条点名并给出修法（`pip install -r requirements.txt`，
  附国内镜像提示）。只预警不阻断；读不到任何一环（无 requirements.txt / 找不到
  site-packages / 读取失败）一律跳过，预警通道不把启动带崩。`launch-path.ts` 顺势抽出
  `pythonEnvRoot` / `sitePackagesDirsForEnvRoot`，torch 判定与依赖核对共用同一份环境布局判据。
