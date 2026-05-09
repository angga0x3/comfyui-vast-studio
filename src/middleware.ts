import { NextRequest, NextResponse } from "next/server";

const REALM = "ComfyUI Vast Studio";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

export function middleware(req: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!password) return NextResponse.next();

  // Allow cron endpoint with its own auth
  if (req.nextUrl.pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(header.slice("Basic ".length));
    const idx = decoded.indexOf(":");
    const provided = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (provided === password) return NextResponse.next();
  } catch {
    /* fall through */
  }
  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
