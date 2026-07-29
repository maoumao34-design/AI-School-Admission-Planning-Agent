import { NextResponse } from 'next/server';
import { handleConditionBuilding } from '@/decision/handlers';
import type { ConditionBuildingRequest } from '@/decision/types';

// 决策核心「对话建立条件」端点（6 步之 01）。
// 进：{ message, conditions, history? }；出：ConditionBuildingResult（reply/missing/conflicts/ready/next_question）。
// 纯 JSON 进出，QA 可 curl/fetch 驱动；建条件阶段不调资格/比较规则，ready=true 后前端再走 eligibility/compare。
export async function POST(request: Request) {
  let body: ConditionBuildingRequest;
  try {
    body = (await request.json()) as ConditionBuildingRequest;
  } catch {
    return NextResponse.json(
      {
        reply: '请求体不是合法 JSON，请重试。',
        conditions: {},
        filled_fields: [],
        missing: ['省份', '年度', '选科', '分数', '位次'],
        conflicts: [],
        ready: false,
        next_question: '你是哪个省份的考生？',
      },
      { status: 400 },
    );
  }
  const result = handleConditionBuilding(body);
  return NextResponse.json(result);
}
