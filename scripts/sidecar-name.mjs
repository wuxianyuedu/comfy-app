/**
 * Tauri sidecar 的命名判据 —— **平台判据的单点**。
 *
 * 为什么单独一件（§12.18 / §12.12）：`bundle.externalBin` 声明的是「无后缀
 * basename」，打包器按目标三元组拼 `node-<triple>[.exe]`。这个拼法原来只住在
 * `build-desktop.mjs`（它无模块级守卫，import 即执行整份构建，别人引不进来）；
 * 而壳门禁（`scripts/shell-gate.mjs`）在 `cargo test` 之前要落位**同名**的
 * sidecar —— 两处各写一份就是「同一份判据的长短两句」，改名时静默漂掉一边。
 * 抽到这个叶子之后两边 import 同一份；Rust 侧 `sidecar_binary_name()` 与之同源
 * （见 launch-and-build.md §9.3），那一半是跨语言对账、不走 import。
 *
 * @param {string} triple 目标三元组（如 `x86_64-pc-windows-msvc`）
 * @param {NodeJS.Platform} [platform]
 * @returns {string} `node-<triple>.exe`（Windows）/ `node-<triple>`（其余）
 */
export function sidecarFileName(triple, platform = process.platform) {
  return platform === "win32" ? `node-${triple}.exe` : `node-${triple}`;
}

/**
 * 从 `cargo -vV` 的输出里取目标三元组（`host:` 行）。
 *
 * 为什么要它：`cargo test` 按宿主三元组编译，而 sidecar 的文件名里带着同一个
 * 三元组 —— 写死平台后缀就是 §9.3 那次事故（Linux 上找 `…windows-msvc.exe`）。
 * 从 cargo 自己嘴里问，比从 `process.arch` 翻译一份映射少一处会漂的表。
 *
 * @param {string} output `cargo -vV` 的 stdout
 * @returns {string | null} 三元组；没有 `host:` 行时 `null`
 */
export function hostTripleFromCargoVersion(output) {
  const m = /^host:\s*(\S+)$/m.exec(output ?? "");
  return m?.[1] ?? null;
}
