const fs = require('node:fs'), path = require('node:path');

module.exports = async function ({ page, state, saved, check, capture, out, baseline }) {
  const button = name => page.getByRole('button', { name, exact: true });
  const textbox = name => page.getByRole('textbox', { name, exact: true });
  const draft = () => textbox('继续共同思考');
  // Sticky controls are exercised by real pointer coordinates: Locator.click's
  // auto-scroll can move a sticky element's scroll owner before pointerdown.
  const openFind=async()=>{const r=await button('查找').boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await textbox('查找讨论原话').waitFor();await paint();};
  const setSearch=async value=>{await textbox('查找讨论原话').evaluate(e=>e.focus({preventScroll:true}));await page.keyboard.press('Control+a');if(value)await page.keyboard.insertText(value);else await page.keyboard.press('Backspace');};
  const host = async () => (await state()).product.host;
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.getByRole('navigation', { name: '三大工作区' }).getByRole('button', { name: 'Agent 协作', exact: true }).click();
  await page.getByRole('radio', { name: 'Trace 内思考', exact: true }).click();
  await button('新建共同思考').click();
  const fixture = [];
  for (let index = 1; index <= 72; index++) {
    let text = `档案第 ${index} 段：保留原始叙述与前后文。\n这是明确保存的用户记录，不是 AI 执行结果。`;
    if(index===12)text+='\n字面符号 [a.b] 与 aXb 是不同的原话。';
    if(index===18)text+='\nAPI、api、Api 都是保留大小写的原话。';
    if (index === 3) {
      text += '\n' + Array.from({ length: 35 }, (_, i) => `前文 ${i + 1}：先核对具体情境，不要只记住关键词。`).join('\n');
      for (let hit = 1; hit <= 14; hit++) text += `\n🧭第 ${hit} 处星河：这一处有自己的原话与上下文。\n紧接的解释 ${hit}，需要和前一句一起阅读。\n后续未决之处 ${hit}，不能自动改成结论。`;
    }
    if (index === 43) {
      text += '\n' + Array.from({ length: 140 }, (_, i) => `长段前文 ${i + 1}：相同段落中仍有不同的阅读位置。`).join('\n');
      text += '\n深处星河：必须露出这一处之前和之后的原话。\n相邻解释：直接跳段标题不能代替看到上下文。';
      text += '\n' + Array.from({ length: 35 }, (_, i) => `中间说明 ${i + 1}：当前命中不是本段最后的命中。`).join('\n');
      text += '\n末尾星河：第二处也必须能准确到达。\n收束原话：保留差异，不要擅自替用户保存。';
    }
    if (index === 70) text += '\n跨页星河：返回后应继续原来的阅读，不要困在结果页。';
    fixture.push(text);
    await draft().fill(text); await button('留下这段思考').click(); await saved();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="继续共同思考"]')?.value === '');
    const newSaved = page.getByRole('button', { name: /^新保存 \d+ 段$/ });
    if (await newSaved.count()) await newSaved.click();
    await page.locator('.wb-messages').getByText(text, { exact: true }).waitFor();
  }
  await draft().fill('主讨论未保存草稿：查找、返回、切换都不能把它自动保存。');
  await button('新建共同思考').click();
  await page.waitForFunction(() => document.querySelectorAll('.wb-messages article').length === 0);
  await draft().fill('海盐第二讨论：自己的正文和草稿不能混到别处。');
  await button('留下这段思考').click(); await saved();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="继续共同思考"]')?.value === '');
  await draft().fill('第二讨论独立的未保存草稿。');
  const initial = (await state()).product;
  const main = Object.values(initial.host.sessions).find(s => s.messages.length === 72);
  check('stress history is created through73 genuine full application UI saves', !!main && Object.values(initial.host.sessions).reduce((n, s) => n + s.messages.length, 0) === 73);
  await textbox('查找协作记录').fill('档案第 3 段');
  await page.locator('[data-record-id="' + main.id + '"]').click();
  const original = JSON.stringify(main.messages), originalDraft = await draft().inputValue();
  await draft().press('Control+Home'); await draft().press('ArrowRight'); await draft().press('Shift+ArrowRight');
  const caret = await draft().evaluate(e => [e.selectionStart, e.selectionEnd]);
  const pane = page.locator('.wb-thinking-pane'), paneBox = await pane.boundingBox();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2);
  await page.mouse.wheel(0, -100000); await paint();
  await page.mouse.wheel(0, 740); await paint();
  const anchor = () => page.locator('.wb-discussion-browser').evaluate(root => {
    const pane = root.closest('.wb-thinking-pane'), bar = root.querySelector('.wb-discussion-toolbar');
    const top = Math.max(pane.getBoundingClientRect().top, bar?.getBoundingClientRect().bottom || 0) + 8;
    const node = [...root.querySelectorAll('[data-reading-message]')].find(e => e.getBoundingClientRect().bottom > top);
    return { id: node?.dataset.readingMessage, offset: node ? node.getBoundingClientRect().top - top : 0, scroll: pane.scrollTop };
  });
  const origin = await anchor();
  const originGeometry=await pane.evaluate(pane=>{const bar=pane.querySelector('.wb-discussion-toolbar');return{paneTop:pane.getBoundingClientRect().top,padding:getComputedStyle(pane).paddingTop,toolbarTop:getComputedStyle(bar).top,barTop:bar.getBoundingClientRect().top,barBottom:bar.getBoundingClientRect().bottom,barHeight:bar.getBoundingClientRect().height}});
  await capture('01-reading-origin');
  const findBox=await button('查找').boundingBox();
  await page.mouse.click(findBox.x+findBox.width/2,findBox.y+findBox.height/2);
  const afterFindClick=await anchor();
  await setSearch('星河'); await paint();
  const observation = async () => ({
    countText: await button('打开匹配段落目录').innerText(),
    renderedMarks: await page.locator('[data-history-hit]').count(),
    activeMarks: await page.locator('[data-current-history-hit=true]').count(),
    target: await page.locator('[data-reading-message][data-search-match=true]').getAttribute('data-reading-index'),
    returnControlCount: await button('返回查找前的阅读位置').count(),
  });
  const first = await observation(); await capture('02-first-search-context');
  const savedReading=await page.evaluate(id=>{const key=Object.keys(localStorage).find(k=>k.includes('browse:thinking:')&&k.endsWith(id));return key?JSON.parse(localStorage.getItem(key)):null;},main.id);
  await textbox('查找讨论原话').press('Enter'); await paint();
  const next = await observation(); await capture('03-next-search-context');
  if (baseline) {
    await button('收起讨论查找').click(); await paint();
    const after = await anchor(); await capture('04-closed-find-reading');
    fs.writeFileSync(path.join(out, 'baseline-observations.json'), JSON.stringify({ origin, first, next, after, expectedOccurrences: 17, expectedOccurrencesInFirstParagraph: 14, fixtureDescription: '72 paragraphs, 14 same-paragraph occurrences, deep multiline hits, independent drafts' }, null, 2));
    check('baseline observation does not change canonical messages, revision, or draft', (await state()).product.revision === initial.revision && JSON.stringify((await host()).sessions[main.id].messages) === original && await draft().inputValue() === originalDraft);
    return;
  }
  const contextGeometry = async label => {
    await paint();
    const value = await page.locator('[data-current-history-hit=true]').evaluate(hit => {
      const article = hit.closest('[data-reading-message]'), pane = hit.closest('.wb-thinking-pane');
      const root = article.closest('.wb-discussion-browser'), bar = root.querySelector('.wb-discussion-toolbar');
      const header = article.querySelector('[data-active-context=true]');
      const h = hit.getBoundingClientRect(), p = pane.getBoundingClientRect(), b = bar.getBoundingClientRect(), c = header.getBoundingClientRect();
      return { message: article.dataset.readingIndex, from: +hit.dataset.historyFrom, hit: { top: h.top, bottom: h.bottom }, header: { top: c.top, bottom: c.bottom }, toolbar: { top: b.top, bottom: b.bottom, height: b.height }, pane: { top: p.top, bottom: p.bottom }, line: parseFloat(getComputedStyle(hit).lineHeight) || 24, style:{background:getComputedStyle(hit).backgroundColor,color:getComputedStyle(hit).color,decoration:getComputedStyle(hit).textDecorationLine,shadow:getComputedStyle(hit).boxShadow} };
    });
    fs.writeFileSync(path.join(out, label + '-geometry.json'), JSON.stringify(value, null, 2));
    check(label + ' exposes the active hit and surrounding lines below its real context header', value.hit.top >= Math.max(value.toolbar.bottom, value.header.bottom) + value.line * .7 && value.hit.bottom <= value.pane.bottom - value.line);
    check(label + ' exposes its paragraph context header without a text-leaking gap',Math.abs(value.header.top-value.toolbar.bottom)<=1&&value.header.bottom<value.pane.bottom);
    check(label + ' retains the compact two-row toolbar', value.toolbar.height <= (page.viewportSize().height <= 720 ? 128 : 136));
    await capture(label); return value;
  };
  check('search count reports17 real occurrences rather than3 paragraphs', first.countText.includes('17') && first.countText.includes('处'));
  check('all14 occurrences in the first paragraph are highlighted with exactly one current hit', first.renderedMarks === 14 && first.activeMarks === 1);
  check('next occurrence stays inside the same paragraph and preserves input focus', next.target === '3' && await textbox('查找讨论原话').evaluate(e => document.activeElement === e));
  await contextGeometry('04-second-occurrence-context');
  for (let current = 2; current < 14; current++) await textbox('查找讨论原话').press('Enter');
  check('navigation reaches the14th occurrence beyond the old10-mark limit', (await observation()).countText.startsWith('14 / 17') && await page.locator('[data-current-history-hit=true]').innerText() === '星河');
  await contextGeometry('05-fourteenth-occurrence');
  await textbox('查找讨论原话').press('Enter');
  check('next occurrence crosses the page boundary into deep paragraph43', (await observation()).target === '43' && (await observation()).countText.startsWith('15 / 17'));
  await contextGeometry('06-deep-context-first');
  await textbox('查找讨论原话').press('Enter');
  await contextGeometry('07-deep-context-last');
  await textbox('查找讨论原话').press('Enter');
  check('the final occurrence reaches paragraph70 without losing the search editor', (await observation()).target === '70' && (await observation()).countText.startsWith('17 / 17') && await textbox('查找讨论原话').evaluate(e => document.activeElement === e));
  await textbox('查找讨论原话').press('Enter');
  check('forward navigation wraps to the first actual occurrence', (await observation()).countText.startsWith('1 / 17') && (await observation()).target === '3');
  await textbox('查找讨论原话').press('Shift+Enter');
  check('Shift+Enter wraps backward to the last actual occurrence', (await observation()).countText.startsWith('17 / 17') && (await observation()).target === '70');
  await button('返回查找前的阅读位置').click(); await paint();
  const restored = await anchor();
  fs.writeFileSync(path.join(out,'return-reading-observation.json'),JSON.stringify({origin,originGeometry,afterFindClick,savedReading,restored},null,2));
  check('return restores the original reading window anchor and pixel offset, not the first result', restored.id === origin.id && Math.abs(restored.offset - origin.offset) <= 3);
  check('return collapses find but retains its query and the untouched draft', await textbox('查找讨论原话').count() === 0 && await button('查找').getAttribute('data-active') === 'true' && await draft().inputValue() === originalDraft);
  await capture('08-original-reading-restored');
  await openFind(); await setSearch('末尾星河');
  await contextGeometry('09-one-deep-result');
  check('single occurrence disables redundant previous and next controls', await button('上一处匹配').isDisabled() && await button('下一处匹配').isDisabled());
  await button('打开匹配段落目录').click();
  const directory = page.getByRole('dialog', { name: '讨论段落目录', exact: true });
  check('the matched directory preview shows the exact deep text', await textbox('查找目录原话').inputValue() === '末尾星河' && (await directory.locator('[data-list-item]').innerText()).includes('末尾星河'));
  await directory.locator('[data-list-item]').click(); await directory.waitFor({ state: 'detached' });
  await contextGeometry('10-directory-deep-result');
  const choose = async query => { await textbox('查找协作记录').fill(query); await page.locator('[data-record-id]').first().click(); await draft().waitFor(); };
  await choose('海盐第二讨论');
  check('another discussion retains its own independent draft', await draft().inputValue() === '第二讨论独立的未保存草稿。');
  await choose('档案第 3 段');
  check('switching back retains the active deep occurrence and draft selection', await page.locator('[data-current-history-hit=true]').innerText() === '末尾星河' && await draft().inputValue() === originalDraft && await draft().evaluate((e, c) => e.selectionStart === c[0] && e.selectionEnd === c[1], caret));
  await page.reload(); await page.locator('[data-workbench-ready=true]').waitFor(); await draft().waitFor();
  check('reload preserves active occurrence and independent reading return point', await page.locator('[data-current-history-hit=true]').innerText() === '末尾星河' && await button('返回查找前的阅读位置').count() === 1);
  await button('返回查找前的阅读位置').click(); await paint();
  const reloadedReturn = await anchor();
  fs.writeFileSync(path.join(out,'reloaded-return-observation.json'),JSON.stringify({origin,reloadedReturn},null,2));
  check('return after discussion switches and reload still reaches the original reading anchor', reloadedReturn.id === origin.id && Math.abs(reloadedReturn.offset - origin.offset) <= 3);
  await openFind(); await setSearch('星河');
  await page.setViewportSize({ width: 390, height: 620 });
  await contextGeometry('11-short-light-current-hit');
  await page.setViewportSize({ width: 900, height: 620 });
  await contextGeometry('12-short-height-current-hit');
  await page.setViewportSize({ width: 1440, height: 940 });
  await button('返回查找前的阅读位置').click(); await paint();
  await openFind();
  const beforeNoMatch = await anchor();
  await setSearch('没有这句原话 🧭 [a.b]'); await paint();
  const afterNoMatch = await anchor();
  fs.writeFileSync(path.join(out,'no-match-observation.json'),JSON.stringify({beforeNoMatch,afterNoMatch,originalDraft,actualDraft:await draft().inputValue(),activeMarks:await page.locator('[data-current-history-hit=true]').count(),beforeIndex:main.messages.findIndex(m=>m.id===beforeNoMatch.id)+1,afterIndex:main.messages.findIndex(m=>m.id===afterNoMatch.id)+1},null,2));
  check('no-match filtering neither moves reading nor changes or saves the draft', afterNoMatch.id === beforeNoMatch.id && Math.abs(afterNoMatch.offset - beforeNoMatch.offset) <= 3 && await draft().inputValue() === originalDraft && await page.locator('[data-current-history-hit=true]').count() === 0);
  await button('清除查找讨论原话').click();
  check('clearing find keeps the editor focused with no false current match', await textbox('查找讨论原话').evaluate(e => document.activeElement === e) && await page.locator('[data-current-history-hit=true]').count() === 0);
  await setSearch('[a.b]');await paint();
  check('brackets and dot are literal searchable characters, not regular expression syntax',(await observation()).target==='12'&&(await observation()).countText.startsWith('1 / 1')&&await page.locator('[data-current-history-hit=true]').innerText()==='[a.b]');
  await setSearch('apI');await paint();
  check('case-insensitive lookup retains the exact original spelling and each occurrence',(await observation()).target==='18'&&(await observation()).countText.includes('3')&&await page.locator('[data-current-history-hit=true]').innerText()==='API');
  await setSearch('星河 未决之处');
  check('multi-term search retains same-paragraph AND semantics and counts literal occurrences', (await observation()).target === '3' && (await observation()).countText.includes('28'));
  await button('返回查找前的阅读位置').click(); await paint();
  check('all find, context, directory, switch and return actions leave canonical history unchanged', (await state()).product.revision === initial.revision && JSON.stringify((await host()).sessions[main.id].messages) === original);
  await openFind();await setSearch('#3');await paint();await button('收起讨论查找').click();
  check('continuation return regression starts with a genuine independent search checkpoint',await button('返回查找前的阅读位置').count()===1);
  await button('打开段落目录').click(); await textbox('查找目录原话').fill('#3');
  await directory.getByRole('button', { name: '接续第 3 段原话', exact: true }).click(); await directory.waitFor({ state: 'detached' });
  await button('取消接续，保留当前草稿').waitFor();
  check('continuing a hit still asks before changing an occupied draft', await draft().inputValue() === originalDraft);
  await button('取消接续，保留当前草稿').click();
  await paint();await page.waitForTimeout(500);
  check('cancelling an occupied-draft choice retains its explicit return to the original paragraph',await button('返回原话').count()===1&&await draft().inputValue()===originalDraft);
  await button('返回原话').click();
  check('editor return remains separate from the earlier search reading checkpoint',await page.locator('[data-reading-message="'+main.messages[2].id+'"]').count()===1&&await button('返回查找前的阅读位置').count()===1);
  await page.locator('[data-reading-message="'+main.messages[2].id+'"]').getByRole('button',{name:'接着这段写',exact:true}).click();
  await button('把原话追加到当前草稿').click();
  if (await button('明确使用当前草稿范围').count()) await button('明确使用当前草稿范围').click();
  await button('留下这段思考').click(); await page.getByText('思考记录已保存', { exact: true }).waitFor(); await saved();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="继续共同思考"]')?.value === '');
  const afterSave = (await host()).sessions[main.id];
  check('explicit continuation saves one real new record, preserving every original body and scope', afterSave.messages.length === 73 && JSON.stringify(afterSave.messages.slice(0, 72)) === original && afterSave.messages.at(-1).text === originalDraft + '\n\n' + fixture[2] && JSON.stringify(afterSave.messages.at(-1).scope.historyIds) === JSON.stringify([main.messages[2].id]));
  await button('新保存 1 段').click(); await button('继续写').click();
  await draft().fill('保存之后的新草稿：不与已确认的原话混淆。');
  await page.reload(); await page.locator('[data-workbench-ready=true]').waitFor(); await draft().waitFor();
  check('reload separates the new saved record from the later unsaved draft', (await host()).sessions[main.id].messages.length === 73 && await draft().inputValue() === '保存之后的新草稿：不与已确认的原话混淆。');
  await button('设置').click();
  await require('./select-control.cjs').selectValue(page.getByRole('combobox', { name: '外观' }), 'dark');
  await button('关闭对话框').click(); await page.getByRole('dialog').waitFor({ state: 'detached' });
  await openFind(); await setSearch('末尾星河');
  await page.setViewportSize({ width: 390, height: 620 }); await contextGeometry('13-short-dark-context');
  await page.setViewportSize({ width: 900, height: 620 }); await contextGeometry('14-short-height-dark-context');
  await page.setViewportSize({ width: 1440, height: 940 });
  await button('设置').click(); await page.getByRole('checkbox', { name: '减少动效', exact: true }).check(); await button('保存设置').click(); await page.getByRole('dialog').waitFor({ state: 'detached' }); await saved();
  check('reduced motion is a genuine saved preference', (await host()).preferences.reduceMotion === true);
  await textbox('查找讨论原话').press('Enter');
  await page.setViewportSize({ width: 390, height: 620 }); await contextGeometry('15-reduced-motion-context');
  fs.writeFileSync(path.join(out, 'search-context-report.json'), JSON.stringify({ passed: true, origin, restored, reloadedReturn, originalParagraphs: 72, originalOccurrences: 17, newParagraphs: 73, newProviderTurns: 0 }, null, 2));
  fs.writeFileSync(path.join(out, 'final-business-state.json'), JSON.stringify(await state(), null, 2));
};
