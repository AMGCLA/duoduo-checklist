/* Presentation layer: retain the existing renderer, task IDs, storage and UI assets. */
(() => {
  'use strict';
  if (typeof render !== 'function' || !document.getElementById('app')) return;
  const $ = selector => document.querySelector(selector);
  const VIEW_KEY = 'dodogu_checklist_workspace_view_v1';
  const view = {tab: 'daily', categories: {daily: '4', weekly: '6', favorites: 'all'}, pending: false};
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (saved?.tab === 'weekly') view.tab = 'weekly';
    if (typeof saved?.pending === 'boolean') view.pending = saved.pending;
    for (const key of ['daily', 'weekly', 'favorites']) {
      const value = saved?.categories?.[key];
      if (value === 'all' || (typeof value === 'string' && /^\d+$/.test(value) && sections[Number(value)] &&
        (key === 'favorites' || sections[Number(value)][1] === key))) view.categories[key] = value;
    }
  } catch (_) { /* A presentation preference must never block saved progress. */ }
  let restoreFocus = null, undo = null, undoTimer;
  let completionStates = new Map();
  const app = $('#app'), hero = $('.hero'), adventure = $('#adventureCard');
  const shell = document.createElement('div');
  shell.className = 'dd-task-workspace';
  shell.innerHTML = `<aside class="dd-sidebar"><div class="dd-nav-heading">任務分類 / CATEGORIES</div><nav id="ddCategories" aria-label="任務分類"></nav><p class="dd-side-note">依照自己的步調完成任務。<br>常做的項目點一下 ☆，<br>下次從「我的最愛」快速開始。</p></aside><div class="dd-task-toolbar"><nav class="dd-view-tabs" aria-label="任務範圍"><button type="button" data-view="daily">每日任務</button><button type="button" data-view="weekly">每週任務</button></nav><div id="ddFilterSlot"></div><div class="dd-view-caption" id="ddViewCaption" role="status" aria-live="polite"></div></div><main class="dd-task-content" aria-label="任務清單"></main>`;
  hero.after(shell);
  const content = shell.querySelector('main');
  content.append(app);
  $('.progress-row').after(adventure);
  // Move the original controls with their original listeners intact.
  const controls = $('.controls');
  controls.prepend($('#themeBtn'));
  controls.classList.add('dd-header-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '常用工具與設定');
  const greeting = document.createElement('div');
  greeting.className = 'dd-greeting';
  greeting.innerHTML = '<h2>今天，也前進一點。</h2>';
  greeting.append($('#today'));
  $('.hero-top').after(greeting);
  greeting.after(controls);
  $('.brand-heading span').textContent = '每日Checklist';
  const tabs = $('.dd-view-tabs');
  tabs.append($('#favoriteFilter'));
  $('#ddFilterSlot').append($('.search-row'));
  $('#taskSearch').placeholder = '搜尋所有任務…';
  $('#taskSearch').setAttribute('aria-label', '搜尋所有任務');
  const pending = document.createElement('label');
  pending.className = 'dd-pending-filter';
  pending.innerHTML = '<input type="checkbox" id="ddPendingOnly">只看未完成';
  $('.search-row').append(pending);
  $('#ddPendingOnly').checked = view.pending;
  const quickLinks = document.createElement('nav');
  quickLinks.className = 'dd-quick-links';
  quickLinks.setAttribute('aria-label', '提醒與冒險');
  quickLinks.innerHTML = '<button type="button" data-info="reminder">活動提醒</button><button type="button" data-info="yesterday">昨日遺漏</button><button type="button" data-info="adventure">冒險成就</button>';
  // Keep the status, quick actions and explanatory information at equal height.
  // Reuse the original nodes so progress and visitor-count listeners remain intact.
  const overview = document.createElement('section');
  overview.className = 'dd-overview-row';
  overview.setAttribute('aria-label', '任務進度與資訊');
  const overviewLeft = document.createElement('div');
  overviewLeft.className = 'dd-overview-left';
  const remaining = $('.remaining');
  if (remaining) overviewLeft.append(remaining);
  overviewLeft.append(quickLinks);
  const overviewInfo = document.createElement('aside');
  overviewInfo.className = 'dd-overview-info';
  overviewInfo.setAttribute('aria-label', '重置時間、瀏覽統計與使用說明');
  for (const [selector, cardName, label] of [
    ['.reset', 'dd-info-reset', '任務重置時間'],
    ['.analytics-row', 'dd-info-analytics', 'Checklist 瀏覽統計'],
    ['.note', 'dd-info-help', '使用說明']
  ]) {
    const node = $(selector);
    if (!node) continue;
    const card = document.createElement('section');
    card.className = 'dd-info-card ' + cardName;
    card.setAttribute('aria-label', label);
    card.append(node);
    overviewInfo.append(card);
  }
  overview.append(overviewLeft, overviewInfo);
  hero.append(overview);
  const toast = document.createElement('div');
  toast.id = 'ddBulkUndo'; toast.hidden = true; toast.setAttribute('role', 'status');
  toast.innerHTML = '<span></span><button type="button">復原</button>';
  document.body.append(toast);

  const activeView = () => localStorage.getItem('dodogu_favorite_filter') === '1' ? 'favorites' : view.tab;
  const query = () => $('#taskSearch').value.trim();
  const currentCategory = () => view.categories[activeView()];
  const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (_) {} };
  const available = row => !row[2] || row[2].includes(now.getDay());
  function openSelected() {
    const category = currentCategory();
    // Opening a navigation target is transient until the user changes a fold.
    // No existing stored folds or task records are rewritten on first load.
    if (category !== 'all') foldState[Number(category)] = false;
    else {
      const active = activeView(), favorites = readChecklistRecord('dodogu_checklist_favorites');
      sections.forEach(([title, type, rows], index) => {
        if (active === 'favorites' ? rows.some(row => favorites[taskId(type, row[0])]) : type === active) foldState[index] = false;
      });
    }
  }
  function syncInfoAccessibility() {
    app.querySelectorAll('.info-section .section-head, .favorite-panel .section-head').forEach(head => {
      head.setAttribute('role', 'button'); head.tabIndex = 0;
      head.setAttribute('aria-expanded', String(!head.parentElement.classList.contains('closed')));
    });
    $('#adventureCollapse').setAttribute('aria-expanded', String(!adventure.classList.contains('collapsed')));
  }
  function renderNavigation() {
    const active = activeView(), favorites = readChecklistRecord('dodogu_checklist_favorites');
    const selected = currentCategory(), nav = $('#ddCategories');
    nav.replaceChildren();
    const indices = sections.map((section, i) => i).filter(i => active === 'favorites'
      ? sections[i][2].some(row => favorites[taskId(sections[i][1], row[0])]) : sections[i][1] === active);
    if (selected !== 'all' && !indices.includes(Number(selected))) view.categories[active] = 'all';
    for (const i of [...indices, 'all']) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'dd-category' + (i === 'all' ? ' dd-category-all' : '');
      button.dataset.category = String(i);
      button.setAttribute('aria-pressed', String(!query() && currentCategory() === String(i)));
      if (i === 'all') {
        button.textContent = active === 'favorites' ? '☷ 全部最愛' : '☷ 全部任務';
      } else {
        const [title, type, rows] = sections[i], store = type === 'weekly' ? weekly : daily;
        const eligible = rows.filter(row => available(row) && (active !== 'favorites' || favorites[taskId(type, row[0])]));
        const done = eligible.filter(row => store[taskId(type, row[0])]).length;
        const image = makeUiIcon(SECTION_TITLE_ICON_MAP[title], 'dd-nav-icon', '');
        if (image) button.append(image);
        const label = document.createElement('span'); label.className = 'dd-category-label';
        label.textContent = title === '每日 BOSS' ? 'BOSS' : title;
        const count = document.createElement('span'); count.className = 'dd-category-count';
        const allEligible = rows.filter(available);
        const complete = allEligible.length > 0 && allEligible.every(row => store[taskId(type, row[0])]);
        button.classList.toggle('dd-is-complete', complete);
        count.textContent = `${complete ? '✓ ' : ''}${done} / ${eligible.length}`;
        if (complete) button.setAttribute('aria-label', `${title}，已完成，${done} / ${eligible.length}`);
        button.append(label, count);
      }
      nav.append(button);
    }
    tabs.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(!query() && active === button.dataset.view)));
    $('#favoriteFilter').textContent = '我的最愛';
    $('#favoriteFilter').setAttribute('aria-pressed', String(!query() && active === 'favorites'));
  }
  function decorateRows() {
    app.querySelectorAll('.item[data-task-id]').forEach(row => {
      const box = row.querySelector('.box'), favorite = row.querySelector('.favorite-btn');
      box.tabIndex = row.classList.contains('disabled') ? -1 : 0;
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-label', row.dataset.taskName);
      box.setAttribute('aria-checked', String(row.classList.contains('done')));
      box.setAttribute('aria-disabled', String(row.classList.contains('disabled')));
      favorite.setAttribute('aria-label', `${favorite.classList.contains('active') ? '取消最愛' : '加入最愛'}：${row.dataset.taskName}`);
      favorite.setAttribute('aria-pressed', String(favorite.classList.contains('active')));
    });
    app.querySelectorAll('.favorite-sync-item').forEach(row => {
      row.tabIndex = 0; row.setAttribute('role', 'checkbox');
      row.setAttribute('aria-checked', String(row.classList.contains('done')));
    });
    app.querySelectorAll('.boss-tab').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    for (const type of ['daily', 'weekly']) {
      const fill = $('#' + type + 'Fill'), bar = fill.parentElement;
      const [done, total] = $('#' + type + 'Count').textContent.split('/').map(Number);
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', type === 'daily' ? '今日完成度' : '本週完成度');
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(total)); bar.setAttribute('aria-valuenow', String(done));
    }
  }
  function beforeRender() {
    const focus = document.activeElement, row = focus?.closest('.item[data-task-id]');
    restoreFocus = row ? {id: row.dataset.taskId, selector: focus.classList.contains('favorite-btn') ? '.favorite-btn' : '.box'}
      : focus?.closest('.boss-tab') ? {boss: focus.closest('.boss-tab').querySelector('.boss-tab-name')?.textContent}
      : focus?.closest('.dd-category') ? {category: focus.closest('.dd-category').dataset.category} : null;
    undo = null; toast.hidden = true; clearTimeout(undoTimer);
  }
  function afterRender() {
    renderNavigation();
    const q = query(), active = activeView();
    const nextCompletionStates = new Map();
    sections.forEach(([title, type, rows], index) => {
      const store = type === 'weekly' ? weekly : daily, eligible = rows.filter(available);
      nextCompletionStates.set(`${todayKey}:${weekKey}:${index}`, eligible.length > 0 && eligible.every(row => store[taskId(type, row[0])]));
    });
    app.querySelectorAll('.category-card').forEach(card => {
      const completionKey = `${todayKey}:${weekKey}:${card.dataset.section}`;
      const complete = nextCompletionStates.get(completionKey);
      card.classList.toggle('dd-is-complete', complete);
      if (complete) {
        const badge = document.createElement('span'); badge.className = 'dd-completion-badge'; badge.textContent = '✓ 已完成';
        card.querySelector('.section-title').append(badge);
        if (completionStates.get(completionKey) === false) {
          card.classList.add('dd-just-completed');
          const navButton = [...$('#ddCategories').children].find(button => button.dataset.category === card.dataset.section);
          navButton?.classList.add('dd-just-completed');
        }
      }
      if (q) card.classList.remove('closed');
      card.querySelector('.category-toggle').setAttribute('aria-expanded', String(!card.classList.contains('closed')));
      const rows = [...card.querySelectorAll('.item[data-task-id]:not(.disabled)')];
      const allDone = rows.length > 0 && rows.every(row => row.classList.contains('done'));
      const bulk = card.querySelector('.select-all-btn');
      bulk.textContent = allDone ? '取消本頁完成' : '本頁全部完成';
      bulk.title = '僅套用目前顯示且今日可進行的任務';
      bulk.disabled = !rows.length;
      if (!card.querySelector('.item[data-task-id]') && !card.querySelector('.boss-empty')) {
        const empty = document.createElement('p'); empty.className = 'dd-empty';
        empty.textContent = view.pending ? '此分類目前沒有未完成項目。取消篩選可查看全部。' : '目前沒有符合條件的任務。';
        card.querySelector('.items').prepend(empty);
      }
      // Keep the original copy buttons, text and links; collapse only the long copy area.
      const promo = card.querySelector('.promo-wrap');
      if (promo) {
        const disclosure = document.createElement('details'); disclosure.className = 'dd-promo-disclosure';
        const summary = document.createElement('summary'); summary.textContent = '推廣文案與連結';
        disclosure.append(summary); promo.before(disclosure); disclosure.append(promo);
        disclosure.open = sessionStorage.getItem('dd_checklist_promo_open') === '1';
        disclosure.addEventListener('toggle', () => { try { sessionStorage.setItem('dd_checklist_promo_open', disclosure.open ? '1' : '0'); } catch (_) {} });
      }
    });
    const favoritePanel = app.querySelector('.favorite-panel');
    if (favoritePanel) {
      favoritePanel.hidden = active !== 'favorites' || !!q;
      if (localStorage.getItem('dodogu_favorites_closed') === null) favoritePanel.classList.add('closed');
    }
    app.querySelectorAll('.info-section').forEach(card => {
      const yesterday = card.textContent.includes('昨日漏掉的任務');
      card.dataset.info = yesterday ? 'yesterday' : 'reminder';
      const key = yesterday ? 'dodogu_yesterday_closed' : 'dodogu_reminder_closed';
      if (localStorage.getItem(key) === null) card.classList.add('closed');
    });
    if (localStorage.getItem('dodogu_adventure_collapsed') === null) adventure.classList.add('collapsed');
    const level = adventure.querySelector('.adventure-level-badge')?.textContent || '';
    const xp = adventure.querySelector('.adventure-xp-text')?.textContent?.split(' · ')[0] || '';
    adventure.querySelector('.adventure-subtitle').textContent = [level, xp].filter(Boolean).join(' · ');
    app.querySelectorAll('.boss-tab').forEach(button => {
      const counts = button.querySelector('.boss-tab-count')?.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      const complete = !!counts && +counts[2] > 0 && +counts[1] === +counts[2];
      button.classList.toggle('dd-is-complete', complete);
      if (complete) {
        const mark = document.createElement('span'); mark.className = 'dd-boss-complete'; mark.textContent = '✓';
        mark.setAttribute('aria-label', '此階段已完成'); button.querySelector('.boss-tab-name').append(mark);
      }
    });
    completionStates = nextCompletionStates;
    const visible = app.querySelectorAll('.item[data-task-id]').length;
    const caption = $('#ddViewCaption');
    caption.textContent = q ? `搜尋「${q}」 · 所有分類 · ${visible} 項結果` : view.pending ? '只顯示未完成項目 · 進度仍以完整任務計算' : '選擇分類，開始今天的冒險。';
    if (!app.querySelector('.category-card') && !app.querySelector('.search-empty')) {
      const empty = document.createElement('p'); empty.className = 'section dd-empty';
      empty.textContent = active === 'favorites' ? '目前沒有符合條件的最愛。點任務旁的 ☆，即可加入最愛。' : '找不到符合條件的任務。';
      app.prepend(empty);
    }
    decorateRows(); syncInfoAccessibility();
    if (restoreFocus) {
      let target;
      if (restoreFocus.id) target = [...app.querySelectorAll('.item[data-task-id]')].find(row => row.dataset.taskId === restoreFocus.id)?.querySelector(restoreFocus.selector);
      else if (restoreFocus.boss) target = [...app.querySelectorAll('.boss-tab')].find(button => button.querySelector('.boss-tab-name')?.textContent === restoreFocus.boss);
      else if (restoreFocus.category) target = [...$('#ddCategories').children].find(button => button.dataset.category === restoreFocus.category);
      if (!target && restoreFocus.id) target = $('#ddPendingOnly');
      target?.focus({preventScroll: true});
    }
  }
  function bulk(card, type) {
    const rows = [...card.querySelectorAll('.item[data-task-id]:not(.disabled)')];
    if (!rows.length) return;
    const snapshot = {daily: structuredClone(daily), weekly: structuredClone(weekly), adventure: structuredClone(adventureProfile), day: todayKey, week: weekKey};
    const store = type === 'weekly' ? weekly : daily;
    const next = !rows.every(row => store[row.dataset.taskId]);
    rows.forEach(row => { const id = row.dataset.taskId; if (next && !store[id]) recordAdventureTaskCompletion(type, id); store[id] = next; });
    writeChecklistRecord((type === 'weekly' ? 'dodogu_weekly_' + weekKey : 'dodogu_daily_' + todayKey), store);
    render(); undo = snapshot;
    toast.querySelector('span').textContent = `${next ? '已完成' : '已取消'} ${rows.length} 項任務`;
    toast.hidden = false;
    undoTimer = setTimeout(() => { toast.hidden = true; undo = null; }, 10000);
  }
  // Toggle ALL four daily BOSS tiers, including those hidden by the current tier tab.
  // Only the existing daily BOSS task IDs are touched; unrelated progress stays unchanged.
  function bulkAllDailyBosses() {
    const bossSection = sections.find(([title, type]) => title === '每日 BOSS' && type === 'daily');
    if (!bossSection) return;
    const eligible = bossSection[2].filter(row => available(row) && isBossTask(row[0]));
    if (!eligible.length) return;
    const allDone = eligible.every(row => !!daily[taskId('daily', row[0])]);
    const next = !allDone; // Complete missing items, or cancel every daily BOSS when all are done.
    const changed = eligible.filter(row => !!daily[taskId('daily', row[0])] !== next);
    if (!changed.length) return;
    const snapshot = {
      daily: structuredClone(daily), weekly: structuredClone(weekly),
      adventure: structuredClone(adventureProfile), day: todayKey, week: weekKey
    };
    const updatedDaily = {...daily};
    for (const row of changed) updatedDaily[taskId('daily', row[0])] = next;
    // Commit the entire daily state first: a failed storage write must not alter progress.
    try {
      writeChecklistRecord('dodogu_daily_' + todayKey, updatedDaily);
    } catch (error) {
      console.warn('Checklist 每日 BOSS 四階切換儲存失敗', error?.name || error);
      alert('目前無法儲存每日 BOSS 進度，原有勾選紀錄已保留。請檢查瀏覽器儲存空間。');
      return;
    }
    daily = updatedDaily;
    if (next) {
      for (const row of changed) {
        try { recordAdventureTaskCompletion('daily', taskId('daily', row[0])); }
        catch (error) { console.warn('Checklist BOSS 冒險紀錄暫時無法更新', error?.name || error); }
      }
    }
    render();
    // Use the existing 10-second undo; cancellation itself does not subtract earned XP.
    clearTimeout(undoTimer);
    undo = snapshot;
    toast.querySelector('span').textContent = next
      ? '每日 BOSS 四階已全部完成（新增 ' + changed.length + ' 項）'
      : '每日 BOSS 四階已取消完成（取消 ' + changed.length + ' 項）';
    toast.hidden = false;
    undoTimer = setTimeout(() => { toast.hidden = true; undo = null; }, 10000);
  }
  window.ddChecklistLayout = {
    beforeRender, afterRender, bulk, bulkAllDailyBosses,
    includesTask: done => !view.pending || !done,
    includesSection(index, type, q, favorites) {
      if (q) return true;
      const active = activeView(), selected = currentCategory();
      return (favorites || type === active) && (selected === 'all' || selected === String(index));
    }
  };
  tabs.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    view.tab = button.dataset.view; localStorage.setItem('dodogu_favorite_filter', '0');
    $('#taskSearch').value = ''; openSelected(); saveView(); render();
  }));
  // The original favorite button still owns its original storage/filter handler.
  $('#favoriteFilter').addEventListener('click', () => { $('#taskSearch').value = ''; openSelected(); saveView(); render(); });
  $('#ddCategories').addEventListener('click', event => {
    const button = event.target.closest('[data-category]'); if (!button) return;
    view.categories[activeView()] = button.dataset.category;
    $('#taskSearch').value = ''; openSelected(); saveView(); render();
  });
  $('#ddPendingOnly').addEventListener('change', event => { view.pending = event.target.checked; saveView(); render(); });
  app.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    const target = event.target;
    if (target.matches('.box[role=checkbox]') && target.getAttribute('aria-disabled') !== 'true') { event.preventDefault(); target.closest('.item').click(); }
    else if (target.matches('.favorite-sync-item, .info-section .section-head, .favorite-panel .section-head')) { event.preventDefault(); target.click(); }
  });
  app.addEventListener('click', () => queueMicrotask(syncInfoAccessibility));
  adventure.addEventListener('click', () => queueMicrotask(syncInfoAccessibility));
  quickLinks.addEventListener('click', event => {
    const info = event.target.closest('[data-info]')?.dataset.info; if (!info) return;
    let target;
    if (info === 'adventure') {
      if (adventure.classList.contains('collapsed')) $('#adventureCollapse').click();
      target = adventure;
    } else {
      localStorage.setItem('dodogu_favorite_filter', '0'); $('#taskSearch').value = ''; render();
      target = app.querySelector(`[data-info="${info}"]`);
      if (target?.classList.contains('closed')) target.querySelector('.section-head').click();
    }
    target?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
  });
  toast.querySelector('button').addEventListener('click', () => {
    if (!undo || undo.day !== todayKey || undo.week !== weekKey) { toast.hidden = true; undo = null; return; }
    daily = undo.daily; weekly = undo.weekly; adventureProfile = undo.adventure;
    writeChecklistRecord('dodogu_daily_' + todayKey, daily);
    writeChecklistRecord('dodogu_weekly_' + weekKey, weekly);
    saveAdventureProfile(); render();
  });
  const progressMenu = $('.dd-checklist-progress-menu');
  document.addEventListener('click', event => { if (!progressMenu.contains(event.target)) progressMenu.open = false; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && progressMenu.open) { progressMenu.open = false; progressMenu.querySelector('summary').focus(); } });
  // All-expand/all-collapse retain their original behavior and reveal the complete scope.
  for (const id of ['expandAll', 'collapseAll']) {
    const button = $('#' + id), original = button.onclick;
    button.onclick = event => {
      view.categories[activeView()] = 'all'; saveView(); original.call(button, event); syncInfoAccessibility();
    };
  }
  openSelected();
  document.body.classList.add('dd-workspace');
  render();
})();
