import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";

/**
 * Call at the top of any API route handler.
 * Returns a 401 response if not authenticated, or null if OK.
 *
 * Usage:
 *   const deny = requireAuth(req);
 *   if (deny) return deny;
 */
export function requireAuth(req: Request): NextResponse | null {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
