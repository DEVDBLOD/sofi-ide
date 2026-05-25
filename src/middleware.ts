import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "sofi_session";

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/send-code",
  "/api/auth/verify-code",
  "/api/auth/check",
  "/login",
  "/_next",
  "/favicon.png",
  "/fonts",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and non-API root page (it handles redirect itself)
  if (
    pathname === "/" ||
    pathname.startsWith("/_next") ||
    pathname.match(/\.(png|jpg|ico|svg|css|js|woff|woff2|ttf|otf|map)$/)
  ) {
    return NextResponse.next();
  }

  // All /api/* and other routes require session cookie
  if (pathname.startsWith("/api/")) {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Token existence checked here; full validation happens in the session store
    // at the application level. Middleware can only do cookie presence check
    // since it runs in the Edge runtime and can't access globalThis stores.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
