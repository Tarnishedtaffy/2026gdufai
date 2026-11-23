import { nowIsoShanghai } from '../../shared/time.ts';
import type { Db } from '../client.ts';

export interface SeedCategory {
  readonly id: number;
  readonly name: string;
  readonly kind: 'expense' | 'income';
  readonly color: string;
  readonly icon: string;
  readonly sortOrder: number;
  readonly keywords: readonly string[];
}

/** 契约第 3 节冻结的 13 个预设类别，ID 固定不可变；自定义类别从 14 起。 */
export const PRESET_CATEGORIES: readonly SeedCategory[] = [
  { id: 1, name: '餐饮', kind: 'expense', color: '#F97316', icon: '🍜', sortOrder: 1,
    keywords: ['早餐', '午餐', '晚餐', '夜宵', '外卖', '餐厅', '饭店', '食堂', '咖啡', '奶茶', '瑞幸', '星巴克', '麦当劳', '肯德基', '火锅', '烧烤', '聚餐', 'AA'] },
  { id: 2, name: '交通', kind: 'expense', color: '#3B82F6', icon: '🚇', sortOrder: 2,
    keywords: ['地铁', '公交', '打车', '滴滴', '出租车', '高铁', '火车', '机票', '加油', '停车', '过路费', '共享单车'] },
  { id: 3, name: '购物', kind: 'expense', color: '#EC4899', icon: '🛍️', sortOrder: 3,
    keywords: ['淘宝', '京东', '拼多多', '超市', '便利店', '商场', '衣服', '鞋', '数码', '日用品', '化妆品'] },
  { id: 4, name: '居住', kind: 'expense', color: '#10B981', icon: '🏠', sortOrder: 4,
    keywords: ['房租', '租金', '水费', '电费', '燃气', '物业', '宽带', '家政', '维修'] },
  { id: 5, name: '娱乐', kind: 'expense', color: '#8B5CF6', icon: '🎮', sortOrder: 5,
    keywords: ['电影', '游戏', '会员', '订阅', 'KTV', '旅游', '酒店', '演出', '健身', '剧本杀'] },
  { id: 6, name: '医疗', kind: 'expense', color: '#EF4444', icon: '💊', sortOrder: 6,
    keywords: ['医院', '药店', '挂号', '体检', '门诊', '药', '牙科'] },
  { id: 7, name: '教育', kind: 'expense', color: '#F59E0B', icon: '📚', sortOrder: 7,
    keywords: ['学费', '课程', '教材', '书', '培训', '考试', '网课'] },
  { id: 8, name: '其他', kind: 'expense', color: '#6B7280', icon: '📦', sortOrder: 8, keywords: [] },
  { id: 9, name: '工资', kind: 'income', color: '#22C55E', icon: '💰', sortOrder: 9,
    keywords: ['工资', '薪资', '月薪', '发薪', '薪酬', '奖金', '年终奖', '绩效', '提成', '兼职', '外快', '稿费', '劳务'] },
  { id: 10, name: '转账', kind: 'income', color: '#F472B6', icon: '🔁', sortOrder: 10,
    keywords: ['转账', '收款', '入账', '红包', '礼金', '压岁钱'] },
  { id: 11, name: '其他收入', kind: 'income', color: '#9CA3AF', icon: '➕', sortOrder: 11,
    keywords: ['利息', '分红', '基金', '股票', '理财', '收益', '报销'] },
  { id: 12, name: '贷款', kind: 'income', color: '#0EA5E9', icon: '🏦', sortOrder: 12,
    keywords: ['贷款', '借款', '借到', '放款', '下款', '借钱'] },
  { id: 13, name: '贷款利息', kind: 'expense', color: '#14B8A6', icon: '🧾', sortOrder: 13,
    keywords: ['贷款利息', '借款利息', '房贷利息', '还款利息', '利息支出', '分期利息', '还利息', '付利息', '还息'] }
];

/** 幂等写入预设类别：已存在则跳过，不覆盖用户改过的颜色或关键词。 */
export function seedCategories(db: Db): void {
  const createdAt = nowIsoShanghai();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO categories
      (id, name, kind, keywords, color, icon, sort_order, is_preset, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
  `);
  const run = db.transaction(() => {
    for (const category of PRESET_CATEGORIES) {
      insert.run(
        category.id,
        category.name,
        category.kind,
        JSON.stringify(category.keywords),
        category.color,
        category.icon,
        category.sortOrder,
        createdAt
      );
    }
  });
  run();
}
