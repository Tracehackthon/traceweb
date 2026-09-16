import { json } from '../../lib/zhihu-oauth.mjs';
import { searchCapabilities } from '../../lib/zhihu-search.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'GET' });
  return json(res, 200, searchCapabilities());
}
