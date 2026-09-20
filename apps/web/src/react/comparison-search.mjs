const DIRECTIONS = Object.freeze({
  counterexample: '反例、限制与不成立的情形',
  experience: '真实做法与实践经验',
  condition: '条件变化与适用边界',
});

const clean = (value) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
const bounded = (value, limit) => {
  const text = clean(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
};

/**
 * Build one bounded provider query from the whole comparison intent.
 * The original matter is deliberately separate from the selected sentence:
 * a generic follow-up such as “还能更好” must not lose what “这个” refers to.
 */
export function buildComparisonSearchQuery(current) {
  const matter = bounded(current?.matter?.originalText || current?.matter?.title, 220);
  const question = bounded(current?.query?.question || current?.matter?.focus?.text, 100);
  const instructions = bounded(current?.query?.instructions, 100);
  const direction = DIRECTIONS[current?.query?.direction] || DIRECTIONS.counterexample;
  const parts = [];
  if (matter) parts.push(`事情背景：${matter}`);
  if (question && question !== matter) parts.push(`当前想弄清：${question}`);
  if (instructions) parts.push(`补充条件：${instructions}`);
  parts.push(`寻找方向：${direction}`);
  return parts.join('；').slice(0, 500);
}
