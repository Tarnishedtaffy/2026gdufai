import { readFileSync } from 'node:fs';

/** 只读取当前冻结契约的反馈表，避免把旧版反馈码永久固定进回归测试。 */
export function contractFeedbackCodes(): string[] {
  const contract = readFileSync(new URL('../../docs/contracts/module2-interface-v1.md', import.meta.url), 'utf8');
  const section = contract.split('### 1.5')[1]?.split('### 1.6')[0] ?? '';
  return Array.from(section.matchAll(/^\|\s*`([A-Z_]+)`\s*\|/gm), match => match[1]!);
}
