## Changed

- **comfy-cli venv 的 POSIX 缺口第一次有了编号（ISSUE #2197），并在 `launch-and-build.md` §9.5
  那条「仍待补的缺口」后面指过去。** 那句话此前是**无主**的：它明写了
  「这是**仍待补的缺口**（该脚本尚未跨平台化），不是「设计上不需要」」，
  但从未立案 —— 台账里没人盯、判据又看不见，属于「会静默失效的清单」那一族。
- 单里记着两句本文一条 bullet 装不下的，本批只留指路：
  ① **为什么它从没自己冒出来**：`scripts/check-ps1-consistency.mjs` 的 ① 只判
  「§9.5 对照表（锚点 `cross-platform-pairs`）里**登记过的每一行**必须两侧都有」，
  它**不扫**「树上有没有只存在一侧的动作未登记」⇒ 一个 Windows-only 的动作结构上判不到
  （复算：那张表当前 31 行，里面没有 comfy-cli 这一条；`grep -n comfy package.json` 也是零命中，
  所以连一条 `pnpm` 形态的手工入口都没有）。
  ② **那份 `.ps1` 同时是 Python 解释器下限的权威源**：`tests/ci-env-probe.test.ts` 读它的源码取值
  （搜 `两处漂了`），`scripts/ci-env-probe.mjs` 的失败话术也指名它 ——
  跨平台化时「下限」只能有一处定义，搬了而不同批改那份用例得到的红是**正确的红**。
- 顺带记一条**读侧其实已经就位**：`src/lib/comfyui/comfy-cli-python.ts` 的落点口径是
  「设置项 `comfyCliPython` > `<cwd>/python-venv/comfy-cli/{Scripts|bin}/python(.exe)`」，
  POSIX 布局已被解释器发现认得（§9.1），缺的只有「建」这一格。
