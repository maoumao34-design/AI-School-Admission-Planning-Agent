import { NextResponse } from 'next/server';
import { handleRecompute, type RecomputeHandlerRequest } from '@/decision/handlers';

// 决策核心改条件重算端点（6 步之 05 改条件重算 + 版本差异）。
// profile_id 仅作 plan 归属（全栈管），不进判定逻辑。
export async function POST(request: Request) {
  let body: RecomputeHandlerRequest;
  try {
    body = (await request.json()) as RecomputeHandlerRequest;
  } catch {
    return NextResponse.json(
      { outcome: { status: 'info_insufficient', reason: '请求体不是合法 JSON' }, trace: null },
      { status: 400 },
    );
  }
  const response = handleRecompute(body);
  return NextResponse.json(response);
}
