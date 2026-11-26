import type { TransactionItem } from '../types/contract';
import { MOCK_TRANSACTIONS } from './data';

/** 前端 mock 的共享账单存储；统计、账单列表与预算都从这里读取。 */
export const storeTransactions: TransactionItem[] = [...MOCK_TRANSACTIONS];
