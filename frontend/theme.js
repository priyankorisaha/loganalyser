/* ============================================================
   theme.js  —  shared across all pages
   1. Dark / Light mode toggle  (persisted in localStorage)
   2. Trie-based autocomplete on any input#searchInput
   ============================================================ */

// ── 1. THEME TOGGLE ─────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('ll_theme') || 'dark';
  if (saved === 'light') document.body.classList.add('light');

  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('ll_theme', isLight ? 'light' : 'dark');
  });
})();


// ── 2. TRIE (JS implementation for autocomplete) ────────────
class TrieNode {
  constructor() { this.children = {}; this.isEnd = false; }
}

class Trie {
  constructor() { this.root = new TrieNode(); }

  insert(word) {
    let node = this.root;
    for (const ch of word.toLowerCase()) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
    }
    node.isEnd = true;
  }

  // Return up to `limit` suggestions matching prefix
  suggest(prefix, limit = 6) {
    let node = this.root;
    for (const ch of prefix.toLowerCase()) {
      if (!node.children[ch]) return [];
      node = node.children[ch];
    }
    const results = [];
    this._dfs(node, prefix.toLowerCase(), results, limit);
    return results;
  }

  _dfs(node, current, results, limit) {
    if (results.length >= limit) return;
    if (node.isEnd) results.push(current);
    for (const ch of Object.keys(node.children).sort()) {
      if (results.length >= limit) return;
      this._dfs(node.children[ch], current + ch, results, limit);
    }
  }
}


// ── 3. AUTOCOMPLETE SETUP ───────────────────────────────────
(function initAutocomplete() {
  const input = document.getElementById('searchInput');
  const list  = document.getElementById('acList');
  if (!input || !list) return;

  // Seed trie with common log keywords + build from stored logs
  const trie = new Trie();
  const seeds = [
    'error','warning','info','fatal','timeout','connection',
    'database','failed','success','retry','exception','null',
    'undefined','overflow','memory','cpu','disk','network',
    'authentication','authorization','request','response',
    'server','client','query','insert','update','delete',
    'payment','gateway','api','login','logout','session',
    'token','expire','invalid','missing','duplicate','crash',
  ];
  seeds.forEach(w => trie.insert(w));

  // Also build from any logs already loaded in the page
  function seedFromLogs(logs) {
    if (!Array.isArray(logs)) return;
    logs.forEach(l => {
      if (!l.message) return;
      l.message.toLowerCase()
        .split(/[\s,.:;()\[\]"']+/)
        .filter(w => w.length > 3)
        .forEach(w => trie.insert(w));
    });
  }

  // Try to pull from app.js allLogs if available
  const poll = setInterval(() => {
    if (typeof allLogs !== 'undefined' && allLogs.length) {
      seedFromLogs(allLogs);
      clearInterval(poll);
    }
  }, 800);

  let activeIdx = -1;

  function showSuggestions(val) {
    const q = val.trim();
    if (!q) { closeList(); return; }
    const suggs = trie.suggest(q, 6);
    if (!suggs.length) { closeList(); return; }

    activeIdx = -1;
    list.innerHTML = suggs.map((s, i) => {
      // Highlight matching prefix
      const hi = `<span class="ac-highlight">${s.slice(0, q.length)}</span>${s.slice(q.length)}`;
      return `<div class="ac-item" data-val="${s}" data-idx="${i}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        ${hi}
      </div>`;
    }).join('');

    list.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = item.dataset.val;
        closeList();
        input.dispatchEvent(new Event('input'));
        // Trigger search if on explore page
        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) applyBtn.click();
      });
    });

    list.classList.add('open');
  }

  function closeList() {
    list.classList.remove('open');
    list.innerHTML = '';
    activeIdx = -1;
  }

  function moveActive(dir) {
    const items = list.querySelectorAll('.ac-item');
    if (!items.length) return;
    items.forEach(i => i.classList.remove('ac-active'));
    activeIdx = (activeIdx + dir + items.length) % items.length;
    items[activeIdx].classList.add('ac-active');
  }

  input.addEventListener('input',   e => showSuggestions(e.target.value));
  input.addEventListener('focus',   e => { if (e.target.value) showSuggestions(e.target.value); });
  input.addEventListener('blur',    ()  => setTimeout(closeList, 150));
  input.addEventListener('keydown', e  => {
    if (!list.classList.contains('open')) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveActive(1); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveActive(-1); }
    if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const active = list.querySelector('.ac-active');
      if (active) { input.value = active.dataset.val; closeList(); }
    }
    if (e.key === 'Escape') closeList();
  });
})();