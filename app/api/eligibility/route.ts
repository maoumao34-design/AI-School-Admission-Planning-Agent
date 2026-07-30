import { NextResponse } from 'next/server';
import { handleEligibility } from '@/decision/handlers';
import { getDefaultCandidates, getDefaultRules } from '@/decision/serverDataset';
import type { EligibilityCheckRequest } from '@/decision/types';

// 决策核心资格校验端点（6 步之 03 资格过滤）。纯 JSON 进出，QA 可 curl/fetch 驱动。
export async function POST(request: Request) {
  let body: EligibilityCheckRequest;
  try {
    body = (await request.json()) as EligibilityCheckRequest;
  } catch {
    return NextResponse.json(
      { outcome: { status: 'info_insufficient', reason: '请求体不是合法 JSON' }, trace: null },
      { status: 400 },
    );
  }
  const response = handleEligibility({
    ...body,
    candidates: getDefaultCandidates(),
    rules: body.rules?.length ? body.rules : getDefaultRules(),
  });
  return NextResponse.json(response);
}
