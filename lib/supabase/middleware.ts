/**
 * Supabase Auth 接入 — Next.js 中间件（Issue MAO-2）
 *
 * 在 middleware.ts 里调用 updateSession，刷新 Auth 会话 cookie 并按需重定向：
 *
 *   // middleware.ts
 *   import { type NextRequest } from "next/server";
 *   import { updateSession } from "@/lib/supabase/middleware";
 *   export async function middleware(req: NextRequest) { return await updateSession(req); }
 *   export const config = { matcher: ["/((?!_next|api|.*\\..*).*)"] };
 *
 * 会话由 Supabase Auth 管理；密钥走 NEXT_PUBLIC_*，不入库。
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll(): { name: string; value: string }[] {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 刷新会话（重要：不要在中间件里跑重业务逻辑）
  await supabase.auth.getUser();

  return response;
}
