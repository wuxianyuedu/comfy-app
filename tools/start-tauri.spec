# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller 打包配置：把 scripts/start_tauri_launcher.py 打成
# start-tauri/start-tauri.exe（onedir 模式，无控制台窗口）。
#
# 源码路径已在下方基于 SPECPATH 计算为绝对路径，因此 pyinstaller 可从任意目录调用。
# 直接双击 tools\build-launcher.bat 最省事（它会自动切到项目根）：
#     pyinstaller --distpath . --workpath build-launcher tools/start-tauri.spec
#
# 为什么用 onedir 而不是 onefile：onefile 运行时会解压到 Temp/_MEI* 临时目录，
# 退出时若子进程仍持有该目录句柄会清理失败并弹警告；onedir 无需解压，
# 双击 start-tauri/start-tauri.exe 即可启动。

# PyInstaller 以 spec 所在目录为基准解析相对路径，而本 spec 位于 tools/ 下，
# 因此源码路径必须基于 SPECPATH 上溯到项目根，否则会拼成 tools/scripts/...。
import os

try:
    _SPEC_DIR = SPECPATH  # PyInstaller 注入：spec 文件所在目录
except NameError:
    _SPEC_DIR = os.getcwd()

_PROJECT_ROOT = os.path.dirname(os.path.abspath(_SPEC_DIR))

a = Analysis(
    [os.path.join(_PROJECT_ROOT, 'scripts', 'start_tauri_launcher.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='start-tauri',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='start-tauri',
)
