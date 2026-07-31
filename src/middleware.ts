import { auth } from "@/lib/auth.config";
import { NextResponse } from "next/server";

// Routes that should require a logged-in session.
const PROTECTED = ["/workspace", "/main/me", "/main/create", "/main/models"];

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const shouldProtect = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  // Local single-user mode keeps auth OPT-IN: enforcement only when
  // AUTH_REQUIRED=true. Default off so the demo user + smoke tests keep working.
  if (process.env.AUTH_REQUIRED === "true" && shouldProtect && !isLoggedIn) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/workspace/:path*", "/main/:path*"],
};
