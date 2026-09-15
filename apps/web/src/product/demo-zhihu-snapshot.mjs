/**
 * Curated from one real Zhihu Open Platform search on 2026-09-15.
 *
 * Query: 收藏很多内容 却很少回看 知识管理
 * Command: zhihu-cli search zhihu --count 5
 *
 * The complete demo consumes only these short interface excerpts. It does not
 * repeat the request in visitors' browsers, spend their quota, or treat a
 * search summary as full text or as the user's own understanding.
 */
export const DEMO_ZHIHU_SNAPSHOT = Object.freeze({
  provider: 'zhihu',
  query: '收藏很多内容 却很少回看 知识管理',
  fetchedAt: '2026-09-15T21:41:28.5400932+08:00',
  contentMode: 'openapi-summary',
  items: Object.freeze([
    Object.freeze({
      id: 'demo:zhihu:reentry-context',
      title: '我们收藏夹的很多内容收藏以后就很难想起来回看了，如何解决呢？',
      author: '拾光者',
      sourceType: '知乎回答',
      excerpt: '很多收藏没有被回看，不一定是因为懒，而是因为收藏动作和回顾动作之间没有建立联系。收藏时保存的是“内容”，但未来真正想知道的往往是三件事：我当时为什么被它打动？那时的我处于什么人生阶段？现在的我还同意这句话吗？',
      url: 'https://www.zhihu.com/question/585059015/answer/2076093417847898217',
    }),
    Object.freeze({
      id: 'demo:zhihu:use-or-delete',
      title: '你收藏的东西，24小时用不上就该删',
      author: '波哥自修',
      sourceType: '知乎文章',
      excerpt: '知识管理不是靠积累，是靠使用。你收藏了多少条“以后再看”的内容？打开你的收藏夹，往前翻——翻到去年同期的，有几篇你是完整看过的？大部分人觉得自己笔记看不过来，是分类没做好、标签不够细、工具不够强。其实问题不在分类。问题在于：你存的大部分东西，根本不需要。',
      url: 'https://zhuanlan.zhihu.com/p/2050214919656706498',
    }),
  ]),
});
