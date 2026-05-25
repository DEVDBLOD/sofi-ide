import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";

export async function GET(req: NextRequest) {
  if (isAuthenticated(req)) {
    return NextResponse.json({ authenticated: true });
  }
  return NextResponse.json({ authenticated: false }, { status: 401 });
}
