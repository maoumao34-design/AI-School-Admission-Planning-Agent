import { NextResponse } from 'next/server';
import { handleCompare, type CompareHandlerRequest } from '@/decision/handlers';
import { getDefaultCandidates, getDefaultRules } from '@/decision/serverDataset';

// 决策核心方案比较端点（6 步之 04 方案比较）。按策略排序 + 概率档/位次差/理由。
export async function POST(request: Request) {
  let body: CompareHandlerRequest;
  try {
    body = (await request.json()) as CompareHandlerRequest;
  } catch {
    return NextResponse.json(
      { outcome: { status: 'info_insufficient', reason: '请求体不是合法 JSON' }, trace: null },
      { status: 400 },
    );
  }
  const response = handleCompare({
    ...body,
    candidates: getDefaultCandidates(),
    rules: body.rules?.length ? body.rules : getDefaultRules(),
  });
  return NextResponse.json(response);
}
