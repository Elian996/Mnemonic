import { NextResponse, type NextRequest } from "next/server";
import { isBlockedHotlink } from "@/lib/uploads/hotlink";

export function middleware(request: NextRequest) {
  if (!isBlockedHotlink(request)) return NextResponse.next();
  return new NextResponse(null, {
    status: 403,
    headers: {
      "Cache-Control": "private, no-store",
      "Vary": "Referer"
    }
  });
}

export const config = {
  matcher: ["/uploads/:path*"]
};
