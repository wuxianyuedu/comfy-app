import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/helper/install
 * 把 install-comfyapp-helper.ps1 作为下载返回，方便用户在别的机器/会话取用。
 * 同机用户其实直接双击项目内 scripts\install-comfyapp-helper.ps1 即可。
 */
export async function GET() {
  const installer = path.join(
    process.cwd(),
    "scripts",
    "install-comfyapp-helper.ps1",
  );
  if (!fs.existsSync(installer)) {
    return NextResponse.json({ error: "installer not found" }, { status: 404 });
  }
  const buf = fs.readFileSync(installer);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="install-comfyapp-helper.ps1"',
    },
  });
}
