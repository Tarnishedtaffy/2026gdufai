import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';
import { classify, type ClassifyContext } from '../../src/modules/ledger/classifier.ts';
import { listCategories } from '../../src/modules/ledger/repository.ts';

const db = openDatabase(':memory:');
seedCategories(db);

function addCustomCategory(): void {
  db.prepare(
    `INSERT INTO categories (id, name, kind, keywords, color, icon, sort_order, is_preset, is_active, created_at)
     VALUES (14, '宠物', 'expense', ?, '#000000', '🐱', 14, 0, 1, '2026-11-16T00:00:00+08:00')`
  ).run(JSON.stringify(['狗粮', '猫粮', '咖啡']));
}

addCustomCategory();

const context: ClassifyContext = {
  categories: listCategories(db),
  userRules: [{ pattern: '星巴克', categoryId: 3 }]
};

afterAll(() => {
  db.close();
});

describe('classify', () => {
  it('命中预设关键词归到餐饮', () => {
    const result = classify({ merchant: null, rawText: '瑞幸 32.5', direction: null }, context);
    expect(result).toMatchObject({ categoryId: 1, source: 'rule', confidence: 0.9 });
  });

  it('自定义类别关键词命中，优先级高于预设', () => {
    const result = classify({ merchant: null, rawText: '买狗粮 60', direction: 'expense' }, context);
    expect(result).toMatchObject({ categoryId: 14, source: 'rule', confidence: 0.92 });
  });

  it('关键词长度相同时自定义类别优先', () => {
    // 「咖啡」同时存在于餐饮（预设）与宠物（自定义）
    const result = classify({ merchant: null, rawText: '咖啡', direction: 'expense' }, context);
    expect(result.categoryId).toBe(14);
  });

  it('用户历史规则优先级最高', () => {
    const result = classify({ merchant: '星巴克', rawText: '星巴克', direction: 'expense' }, context);
    expect(result).toMatchObject({ categoryId: 3, source: 'user_rule', confidence: 0.98 });
  });

  it('方向为收入时不会匹配支出类别，落其他收入', () => {
    const result = classify({ merchant: null, rawText: '瑞幸咖啡', direction: 'income' }, context);
    expect(result).toMatchObject({ categoryId: 11, source: 'fallback', confidence: 0.3 });
  });

  it('方向未定时可匹配收入类别', () => {
    const result = classify({ merchant: null, rawText: '工资到账 8000', direction: null }, context);
    expect(result.categoryId).toBe(9);
  });

  it('无法匹配时兜底到其他', () => {
    const result = classify({ merchant: null, rawText: '莫名其妙的一笔', direction: 'expense' }, context);
    expect(result).toMatchObject({ categoryId: 8, source: 'fallback' });
  });
});
