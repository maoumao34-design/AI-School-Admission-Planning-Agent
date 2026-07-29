/**
 * 端到端：对话建立条件（步骤 01）— handleConditionBuilding 多轮对话。
 * 核心：自然语言 → 抽取/缺失/冲突/追问 → ready=true 可进资格校验。
 * 红线：本阶段不调资格/比较规则；ready 后由前端走 /api/eligibility + /api/compare。
 */
import { describe, expect, it } from 'vitest';
import { handleConditionBuilding } from '../src/decision/handlers';
import type { ConditionBuildingRequest } from '../src/decision/types';

function turn(message: string, conditions: ConditionBuildingRequest['conditions'] = {}) {
  return handleConditionBuilding({ message, conditions });
}

describe('01 对话建立条件 · 多轮追问 + 冲突检测', () => {
  it('首轮：空条件 → missing 全部、追问省份、ready=false', () => {
    const r = turn('你好，我想规划高考志愿');
    expect(r.conditions.province).toBeUndefined();
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.missing).toContain('省份');
    expect(r.ready).toBe(false);
    expect(r.next_question).toBeTruthy();
  });

  it('逐步补全 → ready=true，可进资格校验', () => {
    let r = turn('我是江苏考生，2026年高考');
    expect(r.conditions.province).toBe('江苏');
    expect(r.conditions.year).toBe(2026);
    expect(r.filled_fields).toEqual(expect.arrayContaining(['省份', '年度']));

    r = turn('我考了637分，全省位次5200', r.conditions);
    expect(r.conditions.score).toBe(637);
    expect(r.conditions.rank).toBe(5200);

    r = turn('我选物理，再选化学和生物', r.conditions);
    expect(r.conditions.subject?.primary).toBe('物理');
    expect(r.conditions.subject?.secondary).toEqual(expect.arrayContaining(['化学', '生物']));

    expect(r.missing).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.reply).toContain('齐全');
  });

  it('冲突：选科类别与首选不一致 → conflicts 非空、ready=false', () => {
    const r = turn('我是历史类的，首选物理');
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.ready).toBe(false);
    expect(r.reply).toContain('冲突');
  });

  it('分数越界 → 冲突提示', () => {
    const r = turn('我考了900分');
    expect(r.conflicts.some((c) => c.message.includes('越界'))).toBe(true);
    expect(r.ready).toBe(false);
  });

  it('请求体归一：缺 message/conditions 不报错，按首轮处理', () => {
    const r = handleConditionBuilding({} as never);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.ready).toBe(false);
  });
});
