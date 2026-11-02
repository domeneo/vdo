import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const backendUrl = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:4103";
  const url = new URL(request.url);
  const target = `${backendUrl}/api/fs${url.search}`;

  const auth = request.headers.get("authorization") || "";

  try {
    const res = await fetch(target, {
      headers: {
        Authorization: auth,
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
