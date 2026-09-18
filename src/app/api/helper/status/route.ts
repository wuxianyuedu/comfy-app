import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 端点：GET /api/helper/status
 * 前端用来判断「打开目录」自定义协议助手是否可用。
 * - platform：当前运行平台（win32 才支持 comfyapp:// 注册）。
 * - installerAvailable：项目内安装脚本是否存在。
 * - registered：服务端无法真正感知客户端是否注册了协议（浏览器不暴露），
 *   是否注册由前端点击后的 blur 探测决定，这里恒为 null。
 */
export async function GET() {
  const installer = path.join(
    process.cwd(),
    "scripts",
    "install-comfyapp-helper.ps1",
  );
  return NextResponse.json({
    platform: process.platform,
    protocol: "comfyapp",
    installerAvailable: fs.existsSync(installer),
    installUrl: "/api/helper/install",
    registered: null,
  });
}
