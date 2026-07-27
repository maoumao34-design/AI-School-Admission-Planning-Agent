/**
 * Supabase Auth 接入 — 服务端 Client（Issue MAO-2，Next.js App Router）
 *
 * 在 Server Components / Route Handlers / Server Actions 里用：
 * 读取当前登录用户、按用户隔离读写数据（RLS 自动按用户 JWT 生效）。
 *
 *   import { createClient } from "@/lib/supabase/server";
 *   const supabase = await createClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 *   // 用户态查询自动受 RLS 约束（account_id = auth.uid()）
 *   const { data: profiles } = await supabase.from("profiles").select("*");
 *
 * 密钥仅用 NEXT_PUBLIC_*；service_role 只在 scripts/seed-qa.ts 等可信脚本里用。
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll(): { name: string; value: string }[] {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component 里不能 set cookie；middleware 会刷新会话。
          }
        },
      },
    }
  );
}
