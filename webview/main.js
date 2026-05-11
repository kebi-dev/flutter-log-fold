// @ts-nocheck

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const container = /** @type {HTMLElement} */ (document.getElementById('log-container'));
  const filterInput = /** @type {HTMLInputElement} */ (document.getElementById('input-filter'));
  const counterEl = /** @type {HTMLElement} */ (document.getElementById('counter'));
  const chipBar = /** @type {HTMLElement} */ (document.getElementById('chip-bar'));
  const chipFilterGroup = /** @type {HTMLElement} */ (document.getElementById('chip-filter-group'));
  const chipDynamicGroup = /** @type {HTMLElement} */ (document.getElementById('chip-dynamic-group'));
  const btnClear = /** @type {HTMLElement} */ (document.getElementById('btn-clear'));
  const btnCollapse = /** @type {HTMLElement} */ (document.getElementById('btn-collapse'));
  const btnExpand = /** @type {HTMLElement} */ (document.getElementById('btn-expand'));
  const btnNewViewer = /** @type {HTMLElement} */ (document.getElementById('btn-new-viewer'));
  const chipSystem = /** @type {HTMLElement} */ (document.getElementById('chip-system'));
  const filterFindNav = /** @type {HTMLElement} */ (document.getElementById('filter-find-nav'));
  const filterMatchCounter = /** @type {HTMLElement} */ (document.getElementById('filter-match-counter'));
  const btnFilterPrev = /** @type {HTMLButtonElement} */ (document.getElementById('btn-filter-prev'));
  const btnFilterNext = /** @type {HTMLButtonElement} */ (document.getElementById('btn-filter-next'));

  /** Ordered least → most severe; selecting a chip shows this level and more severe (plus ALL for everything). */
  const THRESHOLD_ORDER = ['verbose', 'debug', 'info', 'warn', 'error', 'critical'];

  /** @type {Set<string>} */
  const dynamicFilterChipsAdded = new Set();

  /** Exactly one mode: all | minimum severity | single dynamic tag */
  let filterMode = 'all';

  /**
   * @param {unknown} c
   * @returns {string}
   */
  function normalizeCategoryKey(c) {
    if (c === undefined || c === null) {
      return 'info';
    }
    const s = String(c).trim().toLowerCase();
    if (!s) {
      return 'info';
    }
    return s === 'warning' ? 'warn' : s;
  }

  /**
   * @param {unknown} raw
   * @returns {string}
   */
  function normalizeFilterMode(raw) {
    if (raw === undefined || raw === null) {
      return 'all';
    }
    const s = String(raw).trim().toLowerCase();
    if (!s || s === 'all') {
      return 'all';
    }
    return s === 'warning' ? 'warn' : s;
  }

  /** Codicon class per severity / preset chip (matches VS Code Problems / debug metaphors). */
  const CHIP_CODICONS = {
    info: 'codicon-info',
    error: 'codicon-error',
    warn: 'codicon-warning',
    debug: 'codicon-bug',
    verbose: 'codicon-output',
    critical: 'codicon-flame',
  };

  let showSystemLogs = false;
  let collapseByDefault = true;
  let maxLogs = 500;
  let totalCount = 0;
  let visibleCount = 0;
  let filterText = '';

  /** @type {HTMLElement[]} */
  let filterMatches = [];
  let filterMatchIndex = -1;
  let findHighlightTimer = null;
  /** Last successful filter text used for highlights (trimmed). Used to detect query changes vs DOM-only refreshes. */
  let lastFindHighlightQuery = '';
  /** Row the user chose (persists across expand/collapse and highlight rebuilds). */
  /** @type {HTMLElement | null} */
  let selectedLogEntry = null;

  /**
   * @param {string} category
   * @returns {boolean}
   */
  function isStandardSeverity(category) {
    return THRESHOLD_ORDER.indexOf(category) !== -1;
  }

  /**
   * @param {string} entryCategory
   * @param {string} mode
   * @returns {boolean}
   */
  function entryMatchesFilterMode(entryCategory, mode) {
    const cat = normalizeCategoryKey(entryCategory);
    const m = mode === 'all' ? 'all' : normalizeFilterMode(mode);
    if (m === 'all') {
      return true;
    }
    const thrIdx = THRESHOLD_ORDER.indexOf(m);
    if (thrIdx >= 0) {
      let effectiveIdx = THRESHOLD_ORDER.indexOf(cat);
      // Bracket tags like gorouter / urlparser are not severity levels; treat them as ~info so
      // VERBOSE/DEBUG/INFO chips still show them (fixes “everything disappears” vs severity mutex).
      if (effectiveIdx < 0) {
        effectiveIdx = THRESHOLD_ORDER.indexOf('info');
      }
      return effectiveIdx >= thrIdx;
    }
    return cat === m;
  }

  /**
   * Tooltip for mutex severity / ALL chips.
   * @param {string} category
   * @returns {string}
   */
  function mutexChipTitle(category) {
    if (category === 'all') {
      return 'Show all logs (all levels and tags)';
    }
    const thrIdx = THRESHOLD_ORDER.indexOf(category);
    if (thrIdx >= 0) {
      const rest = THRESHOLD_ORDER.slice(thrIdx);
      return 'Minimum severity: ' + category + ' — shows ' + rest.join(', ');
    }
    return 'Show only logs with tag [' + category + ']';
  }

  /**
   * Mutex filter chip (radio): ALL, severity thresholds, or dynamic tag.
   * @param {string} category
   * @param {'all' | 'severity' | 'dynamic'} kind
   */
  function createMutexFilterChip(category, kind) {
    const key = normalizeCategoryKey(category === 'all' ? 'all' : category);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-filter-option';
    chip.dataset.category = kind === 'all' ? 'all' : key;
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', 'false');

    let iconClass = 'codicon-tag';
    if (kind === 'all') {
      iconClass = 'codicon-list-flat';
    } else if (kind === 'severity') {
      iconClass = CHIP_CODICONS[key] || 'codicon-symbol-misc';
    }

    const icon = document.createElement('span');
    icon.className = 'codicon chip-icon ' + iconClass;
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = (kind === 'all' ? 'all' : key).toUpperCase();

    chip.appendChild(icon);
    chip.appendChild(label);

    if (kind === 'dynamic') {
      chip.classList.add('chip-dynamic-tag');
      const hue = hashStringToHue(key);
      chip.style.background = 'hsl(' + hue + ', 55%, 35%)';
      chip.style.color = '#fff';
    }

    const titleCat = kind === 'all' ? 'all' : key;
    const tip =
      mutexChipTitle(titleCat) +
      (kind === 'all' ? '' : ' · Click again while active to show all');
    chip.title = tip;
    chip.setAttribute('aria-label', tip);

    (kind === 'dynamic' ? chipDynamicGroup : chipFilterGroup).appendChild(chip);
  }

  function initChipBar() {
    createMutexFilterChip('all', 'all');
    for (const sev of THRESHOLD_ORDER) {
      createMutexFilterChip(sev, 'severity');
    }
    filterMode = 'all';
    updateChipUI();
  }

  /**
   * Add a mutex chip for a dynamic `[tag]` category (not a standard severity).
   * @param {string} category
   */
  function ensureCategoryAndChip(category) {
    const cat = normalizeCategoryKey(category || 'info');
    if (cat === 'all' || isStandardSeverity(cat)) {
      return;
    }
    if (dynamicFilterChipsAdded.has(cat)) {
      return;
    }
    dynamicFilterChipsAdded.add(cat);
    createMutexFilterChip(cat, 'dynamic');
    updateChipUI();
  }

  /**
   * Deterministic hue from string (0-360).
   * @param {string} str
   * @returns {number}
   */
  function hashStringToHue(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return ((hash % 360) + 360) % 360;
  }

  initChipBar();

  // ── Smart auto-scroll ──
  let userAtBottom = true;
  const SCROLL_THRESHOLD = 30;

  container.addEventListener('scroll', () => {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    userAtBottom = distanceFromBottom <= SCROLL_THRESHOLD;
  });

  // Capture phase: clicks inside <summary> otherwise toggle <details> before we handle the link.
  container.addEventListener('click', (e) => {
    const link = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.dart-source-link'));
    if (!link || !container.contains(link)) { return; }
    e.preventDefault();
    e.stopPropagation();
    const pkg = link.dataset.package;
    const rel = link.dataset.relativePath;
    const line = parseInt(link.dataset.line || '0', 10);
    const col = parseInt(link.dataset.column || '1', 10);
    if (!pkg || !rel) { return; }
    vscode.postMessage({ command: 'openDartLocation', packageName: pkg, relativePath: rel, line, column: col });
  }, true);

  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') { return; }
    const link = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.dart-source-link'));
    if (!link || !container.contains(link)) { return; }
    e.preventDefault();
    const pkg = link.dataset.package;
    const rel = link.dataset.relativePath;
    const line = parseInt(link.dataset.line || '0', 10);
    const col = parseInt(link.dataset.column || '1', 10);
    if (!pkg || !rel) { return; }
    vscode.postMessage({ command: 'openDartLocation', packageName: pkg, relativePath: rel, line, column: col });
  });

  container.addEventListener(
    'toggle',
    () => {
      scheduleRefreshFindHighlights();
    },
    true,
  );

  /**
   * @param {HTMLElement | null} entry
   */
  function setSelectedLogEntry(entry) {
    if (selectedLogEntry === entry) {
      return;
    }
    if (selectedLogEntry) {
      selectedLogEntry.classList.remove('log-entry-selected');
    }
    selectedLogEntry = entry;
    if (selectedLogEntry) {
      selectedLogEntry.classList.add('log-entry-selected');
    }
  }

  /**
   * @param {HTMLElement} entry
   * @param {HTMLElement} target
   */
  function handleLogEntryClick(entry, target) {
    flushPendingFindRefresh();
    setSelectedLogEntry(entry);

    const q = filterInput.value.trim();
    if (!q || filterMatches.length === 0) {
      updateFindNavUI();
      return;
    }

    const clickedMark = /** @type {HTMLElement | null} */ (target.closest('mark.filter-match'));
    let newIdx = -1;
    if (clickedMark) {
      newIdx = filterMatches.indexOf(clickedMark);
    }
    if (newIdx < 0) {
      newIdx = firstGlobalMatchIndexInEntry(entry);
    }
    if (newIdx >= 0) {
      filterMatches.forEach((m) => m.classList.remove('filter-match-current'));
      filterMatchIndex = newIdx;
      filterMatches[newIdx].classList.add('filter-match-current');
    }
    updateFindNavUI();
  }

  // Bubble phase: row selection + optional jump to match on that row (dart links use capture + stopPropagation).
  container.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? /** @type {HTMLElement} */ (e.target) : null);
    if (!target || !container.contains(target)) {
      return;
    }
    if (target.closest('.dart-source-link')) {
      return;
    }
    const entry = /** @type {HTMLElement | null} */ (target.closest('.log-entry'));
    if (!entry || entry.classList.contains('hidden')) {
      return;
    }
    handleLogEntryClick(entry, target);
  });

  // ── ANSI → HTML converter ──

  const ANSI_COLORS = [
    'var(--vscode-terminal-ansiBlack, #000000)',
    'var(--vscode-terminal-ansiRed, #cd3131)',
    'var(--vscode-terminal-ansiGreen, #0dbc79)',
    'var(--vscode-terminal-ansiYellow, #e5e510)',
    'var(--vscode-terminal-ansiBlue, #2472c8)',
    'var(--vscode-terminal-ansiMagenta, #bc3fbc)',
    'var(--vscode-terminal-ansiCyan, #11a8cd)',
    'var(--vscode-terminal-ansiWhite, #e5e5e5)',
  ];
  const ANSI_BRIGHT = [
    'var(--vscode-terminal-ansiBrightBlack, #666666)',
    'var(--vscode-terminal-ansiBrightRed, #f14c4c)',
    'var(--vscode-terminal-ansiBrightGreen, #23d18b)',
    'var(--vscode-terminal-ansiBrightYellow, #f5f543)',
    'var(--vscode-terminal-ansiBrightBlue, #3b8eea)',
    'var(--vscode-terminal-ansiBrightMagenta, #d670d6)',
    'var(--vscode-terminal-ansiBrightCyan, #29b8db)',
    'var(--vscode-terminal-ansiBrightWhite, #ffffff)',
  ];

  /**
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * @param {number} n
   * @returns {string}
   */
  function color256(n) {
    if (n < 0 || n > 255) { return '#fff'; }
    if (n < 8) { return ANSI_COLORS[n]; }
    if (n < 16) { return ANSI_BRIGHT[n - 8]; }
    if (n < 232) {
      n -= 16;
      const r = Math.floor(n / 36) * 51;
      const g = Math.floor((n % 36) / 6) * 51;
      const b = (n % 6) * 51;
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
    const v = (n - 232) * 10 + 8;
    return 'rgb(' + v + ',' + v + ',' + v + ')';
  }

  /**
   * @param {number[]} codes
   * @returns {string}
   */
  function codesToStyle(codes) {
    const parts = [];
    let i = 0;
    while (i < codes.length) {
      const c = codes[i];
      if (c === 1) { parts.push('font-weight:bold'); }
      else if (c === 2) { parts.push('opacity:0.7'); }
      else if (c === 3) { parts.push('font-style:italic'); }
      else if (c === 4) { parts.push('text-decoration:underline'); }
      else if (c >= 30 && c <= 37) { parts.push('color:' + ANSI_COLORS[c - 30]); }
      else if (c >= 90 && c <= 97) { parts.push('color:' + ANSI_BRIGHT[c - 90]); }
      else if (c >= 40 && c <= 47) { parts.push('background-color:' + ANSI_COLORS[c - 40]); }
      else if (c >= 100 && c <= 107) { parts.push('background-color:' + ANSI_BRIGHT[c - 100]); }
      else if (c === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        parts.push('color:' + color256(codes[i + 2]));
        i += 2;
      } else if (c === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        parts.push('background-color:' + color256(codes[i + 2]));
        i += 2;
      } else if (c === 38 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        parts.push('color:rgb(' + codes[i + 2] + ',' + codes[i + 3] + ',' + codes[i + 4] + ')');
        i += 4;
      } else if (c === 48 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        parts.push('background-color:rgb(' + codes[i + 2] + ',' + codes[i + 3] + ',' + codes[i + 4] + ')');
        i += 4;
      }
      i++;
    }
    return parts.join(';');
  }

  /**
   * Convert ANSI escape codes to HTML spans with inline styles.
   * @param {string} text
   * @returns {string}
   */
  function ansiToHtml(text) {
    const re = /\x1b\[([0-9;]*)([a-zA-Z])/g;
    let result = '';
    let lastIdx = 0;
    let openSpans = 0;
    let m;

    while ((m = re.exec(text)) !== null) {
      result += escapeHtml(text.substring(lastIdx, m.index));
      lastIdx = re.lastIndex;

      if (m[2] !== 'm') { continue; }

      const raw = m[1];
      const codes = raw === '' ? [0] : raw.split(';').map(Number);

      if (codes[0] === 0 && (codes.length === 1 || raw === '')) {
        while (openSpans > 0) { result += '</span>'; openSpans--; }
      } else {
        const style = codesToStyle(codes);
        if (style) {
          result += '<span style="' + style + '">';
          openSpans++;
        }
      }
    }

    result += escapeHtml(text.substring(lastIdx));
    while (openSpans > 0) { result += '</span>'; openSpans--; }
    return result;
  }

  /** Matches Flutter / Dart stack frames (with or without wrapping parentheses). */
  var DART_PACKAGE_LOC_RE = /\bpackage:([a-zA-Z_][a-zA-Z0-9_]*)\/([^:\s)]+\.dart):(\d+):(\d+)/g;

  /**
   * @param {string} plainText
   * @returns {{ packageName: string, relativePath: string, line: number, column: number, label: string }[]}
   */
  function extractDartPackageRefs(plainText) {
    if (!plainText) return [];
    var seen = Object.create(null);
    var out = [];
    var re = new RegExp(DART_PACKAGE_LOC_RE.source, 'g');
    var m;
    while ((m = re.exec(plainText)) !== null) {
      var pkg = m[1];
      var rel = m[2];
      var lineNum = m[3];
      var colNum = m[4];
      var key = pkg + '\0' + rel + '\0' + lineNum + '\0' + colNum;
      if (seen[key]) continue;
      seen[key] = true;
      var parts = rel.split('/');
      var fileName = parts[parts.length - 1];
      out.push({
        packageName: pkg,
        relativePath: rel,
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        label: fileName + ':' + lineNum,
      });
    }
    return out;
  }

  /**
   * Prefer the #0 stack frame's package location (immediate caller site).
   * Otherwise first package ref in the entry (document order).
   * @param {string} plainText
   * @returns {{ packageName: string, relativePath: string, line: number, column: number, label: string }[]}
   */
  function pickPrimaryCallerRefs(plainText) {
    if (!plainText) return [];
    var lines = plainText.split(/\r?\n/);
    var li;
    for (li = 0; li < lines.length; li++) {
      if (/^\s*#0\b/.test(lines[li])) {
        var fromFrame = extractDartPackageRefs(lines[li]);
        if (fromFrame.length > 0) {
          return [fromFrame[0]];
        }
      }
    }
    var all = extractDartPackageRefs(plainText);
    return all.length > 0 ? [all[0]] : [];
  }

  /**
   * Right-hand column links (Debug Console style).
   * @param {string} plainText
   * @param {{ primaryCallerOnly?: boolean }} [options]
   * @returns {HTMLElement | null}
   */
  function createSourceGutter(plainText, options) {
    options = options || {};
    var refs;
    var extraHiddenCount = 0;
    if (options.primaryCallerOnly) {
      refs = pickPrimaryCallerRefs(plainText);
      var totalUnique = extractDartPackageRefs(plainText).length;
      extraHiddenCount = Math.max(0, totalUnique - refs.length);
    } else {
      refs = extractDartPackageRefs(plainText);
    }
    if (refs.length === 0) return null;
    var aside = document.createElement('aside');
    aside.className = 'log-entry-source-gutter';
    aside.setAttribute('aria-label', 'Jump to source');
    var maxLinks = options.primaryCallerOnly ? 1 : 10;
    if (extraHiddenCount > 0) {
      var more = document.createElement('span');
      more.className = 'log-entry-source-gutter-more';
      more.textContent = '+' + extraHiddenCount;
      more.title = extraHiddenCount + ' more location(s) — expand the log to see full stack links';
      aside.appendChild(more);
    }
    for (var i = 0; i < refs.length && i < maxLinks; i++) {
      var r = refs[i];
      var span = document.createElement('span');
      span.className = 'dart-source-link dart-source-link--gutter';
      span.setAttribute('role', 'link');
      span.setAttribute('tabindex', '0');
      span.dataset.package = r.packageName;
      span.dataset.relativePath = r.relativePath;
      span.dataset.line = String(r.line);
      span.dataset.column = String(r.column);
      span.textContent = r.label;
      aside.appendChild(span);
    }
    return aside;
  }

  /** Collapsed block summary: keep one tight line (full text on hover via title). */
  var COLLAPSED_SUMMARY_MAX_DEFAULT = 110;
  var COLLAPSED_SUMMARY_MAX_ERROR = 72;

  /**
   * @param {string} plain
   * @param {number} maxLen
   */
  function ellipsisCollapsedSummary(plain, maxLen) {
    if (!plain || plain.length <= maxLen) return plain;
    return plain.slice(0, Math.max(1, maxLen - 1)) + '\u2026';
  }

  /**
   * Linkify (package:name/path/file.dart:line:col) in plain text; escapes non-match segments.
   * @param {string} plainChunk
   * @returns {string}
   */
  function injectDartSourceLinksHtml(plainChunk) {
    if (!plainChunk) return '';
    var out = '';
    var last = 0;
    var re = new RegExp('\\((' + DART_PACKAGE_LOC_RE.source + ')\\)', 'g');
    var m;
    while ((m = re.exec(plainChunk)) !== null) {
      out += escapeHtml(plainChunk.slice(last, m.index));
      var pkg = m[2];
      var rel = m[3];
      var lineNum = m[4];
      var colNum = m[5];
      var pathParts = rel.split('/');
      var fileName = pathParts[pathParts.length - 1];
      var dirPrefix = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') + '/' : '';
      var openParen = '(package:' + pkg + '/' + dirPrefix;
      out += escapeHtml(openParen);
      out += '<span class="dart-source-link" role="link" tabindex="0" data-package="' +
        escapeHtml(pkg) + '" data-relative-path="' + escapeHtml(rel) + '" data-line="' +
        lineNum + '" data-column="' + colNum + '">' +
        escapeHtml(fileName + ':' + lineNum) + '</span>';
      out += escapeHtml(':' + colNum + ')');
      last = re.lastIndex;
    }
    out += escapeHtml(plainChunk.slice(last));
    return out;
  }

  /**
   * Like ansiToHtml but injects Dart package links inside plain-text segments.
   * @param {string} text
   * @returns {string}
   */
  function ansiToHtmlWithDartLinks(text) {
    const re = /\x1b\[([0-9;]*)([a-zA-Z])/g;
    let result = '';
    let lastIdx = 0;
    let openSpans = 0;
    let m;

    while ((m = re.exec(text)) !== null) {
      result += injectDartSourceLinksHtml(text.substring(lastIdx, m.index));
      lastIdx = re.lastIndex;

      if (m[2] !== 'm') { continue; }

      const raw = m[1];
      const codes = raw === '' ? [0] : raw.split(';').map(Number);

      if (codes[0] === 0 && (codes.length === 1 || raw === '')) {
        while (openSpans > 0) { result += '</span>'; openSpans--; }
      } else {
        const style = codesToStyle(codes);
        if (style) {
          result += '<span style="' + style + '">';
          openSpans++;
        }
      }
    }

    result += injectDartSourceLinksHtml(text.substring(lastIdx));
    while (openSpans > 0) { result += '</span>'; openSpans--; }
    return result;
  }

  // ── Message handling ──

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'log':
        addEntry(message.entry);
        break;
      case 'batch':
        if (message.knownTags) {
          for (const tag of message.knownTags) {
            ensureCategoryAndChip(tag);
          }
        }
        addBatch(message.entries);
        break;
      case 'clear':
        clearAll();
        break;
      case 'settings':
        if (message.collapseByDefault !== undefined) {
          collapseByDefault = message.collapseByDefault;
        }
        if (message.maxLogs !== undefined) {
          maxLogs = message.maxLogs;
        }
        break;
    }
  });

  // ── Toolbar events ──

  btnClear.addEventListener('click', () => {
    clearAll();
    vscode.postMessage({ command: 'clear' });
  });

  btnCollapse.addEventListener('click', () => {
    container.querySelectorAll('details[open]').forEach((d) => d.removeAttribute('open'));
  });

  btnExpand.addEventListener('click', () => {
    container.querySelectorAll('details:not([open])').forEach((d) => d.setAttribute('open', ''));
  });

  btnNewViewer.addEventListener('click', () => {
    vscode.postMessage({ command: 'openNewViewer' });
  });

  filterInput.addEventListener('input', () => {
    filterText = filterInput.value.toLowerCase();
    applyFilters();
  });

  btnFilterPrev.addEventListener('click', () => {
    navigateFilterMatch(-1);
  });

  btnFilterNext.addEventListener('click', () => {
    navigateFilterMatch(1);
  });

  window.addEventListener('keydown', (e) => {
    const q = filterInput.value.trim();
    if (!q || filterMatches.length === 0) { return; }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.key !== 'g' || e.altKey) { return; }
    e.preventDefault();
    if (e.shiftKey) {
      navigateFilterMatch(-1);
    } else {
      navigateFilterMatch(1);
    }
  });

  // ── System logs toggle ──

  chipSystem.addEventListener('click', () => {
    showSystemLogs = !showSystemLogs;
    if (showSystemLogs) {
      chipSystem.classList.add('active');
      chipSystem.setAttribute('aria-checked', 'true');
    } else {
      chipSystem.classList.remove('active');
      chipSystem.setAttribute('aria-checked', 'false');
    }
    applyFilters();
  });

  // ── Chip bar (category chips only) ──

  chipBar.addEventListener('click', (e) => {
    const chip = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('.chip-filter-option[data-category]')
    );
    if (!chip) {
      return;
    }

    const category = chip.dataset.category;
    if (!category) {
      return;
    }

    const next = normalizeFilterMode(category);
    const current = normalizeFilterMode(filterMode);
    if (next === current) {
      if (next !== 'all') {
        filterMode = 'all';
        updateChipUI();
        applyFilters();
        focusMutexChipByCategory('all');
      }
      return;
    }
    filterMode = next;
    updateChipUI();
    applyFilters();
  });

  // ── Rendering ──

  /**
   * Normalize category for backward compat (warning → warn).
   * @param {any} entry
   * @returns {any}
   */
  function normalizeEntry(entry) {
    if (entry.category === 'warning') {
      entry.category = 'warn';
    }
    return entry;
  }

  /**
   * @param {any} entry
   */
  function addEntry(entry) {
    normalizeEntry(entry);
    ensureCategoryAndChip(entry.category);
    totalCount++;
    const el = createEntryElement(entry);
    container.appendChild(el);

    // Trim oldest DOM nodes to enforce maxLogs limit
    while (container.children.length > maxLogs) {
      const removed = container.firstElementChild;
      if (!removed) { break; }
      if (!removed.classList.contains('hidden')) {
        visibleCount--;
      }
      container.removeChild(removed);
      totalCount--;
    }

    const isVisible = applyFilterToElement(el, entry);
    if (isVisible) { visibleCount++; }
    updateCounter(visibleCount);
    scheduleRefreshFindHighlights();
    autoScroll();
  }

  /**
   * @param {any[]} entries
   */
  function addBatch(entries) {
    container.innerHTML = '';
    totalCount = 0;
    visibleCount = 0;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      normalizeEntry(entry);
      ensureCategoryAndChip(entry.category);
      totalCount++;
      const el = createEntryElement(entry);
      fragment.appendChild(el);
    }
    container.appendChild(fragment);
    applyFilters();
    autoScroll();
  }

  function clearAll() {
    if (findHighlightTimer !== null) {
      clearTimeout(findHighlightTimer);
      findHighlightTimer = null;
    }
    setSelectedLogEntry(null);
    lastFindHighlightQuery = '';
    container.innerHTML = '';
    totalCount = 0;
    visibleCount = 0;
    userAtBottom = true;
    filterMatches = [];
    filterMatchIndex = -1;
    resetDynamicFilterChips();
    updateCounter(0);
    updateFindNavUI();
  }

  function resetDynamicFilterChips() {
    dynamicFilterChipsAdded.clear();
    chipDynamicGroup.innerHTML = '';
    filterMode = 'all';
    updateChipUI();
  }

  /**
   * @param {any} entry
   * @returns {HTMLElement}
   */
  function createEntryElement(entry) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.type === 'plain' ? 'plain' : 'block'}`;
    const catKey = normalizeCategoryKey(entry.category);
    div.dataset.category = catKey;
    div.dataset.source = entry.source || 'flutter';
    // Search text: ANSI-stripped
    const rawText = (entry.lines || []).join('\n');
    div.dataset.searchText = stripAnsi(rawText).toLowerCase();

    if (entry.type === 'plain') {
      const main = document.createElement('div');
      main.className = 'log-entry-main';
      const badge = createBadge(catKey);
      main.appendChild(badge);
      const textSpan = document.createElement('span');
      textSpan.className = 'log-entry-text';
      textSpan.innerHTML = ansiToHtmlWithDartLinks(rawText);
      main.appendChild(textSpan);
      div.appendChild(main);
      const plainGutter = createSourceGutter(stripAnsi(rawText));
      if (plainGutter) {
        div.appendChild(plainGutter);
      }
    } else {
      const details = document.createElement('details');
      if (!collapseByDefault) {
        details.setAttribute('open', '');
      }

      const summary = document.createElement('summary');

      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '\u25B6';

      const badge = createBadge(catKey);

      const timestamp = document.createElement('span');
      timestamp.className = 'timestamp';
      timestamp.textContent = entry.timestamp;

      const summaryText = document.createElement('span');
      summaryText.className = 'summary-text';
      const firstLine = (entry.lines && entry.lines[0]) || '';
      var sumFull = entry.summary || '';
      var maxCollapsed =
        catKey === 'error' || catKey === 'critical'
          ? COLLAPSED_SUMMARY_MAX_ERROR
          : COLLAPSED_SUMMARY_MAX_DEFAULT;
      var sumShown = ellipsisCollapsedSummary(sumFull, maxCollapsed);
      summaryText.title = sumFull;
      if (entry.formattedSummary) {
        const ansiMatch = firstLine.match(/^(\x1b\[[0-9;]*m)+/);
        const colorPrefix = ansiMatch ? ansiMatch[0] : '';
        summaryText.innerHTML = ansiToHtmlWithDartLinks(colorPrefix + sumShown + (colorPrefix ? '\x1b[0m' : ''));
      } else {
        summaryText.innerHTML = injectDartSourceLinksHtml(sumShown);
      }

      summary.appendChild(arrow);
      summary.appendChild(badge);
      summary.appendChild(timestamp);
      summary.appendChild(summaryText);
      const blockGutter = createSourceGutter(stripAnsi(rawText), { primaryCallerOnly: true });
      if (blockGutter) {
        summary.appendChild(blockGutter);
      }

      const content = document.createElement('div');
      content.className = 'block-content';
      content.innerHTML = renderBlockContent(entry.lines || []);

      details.appendChild(summary);
      details.appendChild(content);
      div.appendChild(details);
    }

    return div;
  }

  /**
   * @param {string} category
   * @returns {HTMLElement}
   */
  function createBadge(category) {
    const badge = document.createElement('span');
    const isSeverity = isStandardSeverity(category);
    badge.className = 'badge' + (isSeverity ? ' ' + category : '');
    badge.textContent = category.toUpperCase();

    if (!isSeverity) {
      // Dynamic tag: use hash color
      const hue = hashStringToHue(category);
      badge.style.background = 'hsl(' + hue + ', 55%, 35%)';
      badge.style.color = '#fff';
    }

    return badge;
  }

  // ── Filter find (highlight & match navigation) ──

  /**
   * @param {string} s
   * @returns {string}
   */
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * @param {HTMLElement} root
   */
  function stripFilterHighlights(root) {
    root.querySelectorAll('mark.filter-match').forEach((m) => {
      const mark = /** @type {HTMLElement} */ (m);
      const parent = mark.parentNode;
      if (!parent) { return; }
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      /** @type {HTMLElement} */ (parent).normalize();
    });
  }

  /**
   * @param {Text} node
   * @returns {boolean}
   */
  function textNodeInsideDartLink(node) {
    return !!node.parentElement && !!node.parentElement.closest('.dart-source-link');
  }

  /**
   * @param {Text} node
   * @returns {boolean}
   */
  function textNodeInClosedBlockBody(node) {
    let el = node.parentElement;
    while (el && el !== container) {
      if (el.classList.contains('block-content')) {
        const det = el.closest('details');
        if (det && !det.open) { return true; }
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * @param {Text} textNode
   * @param {RegExp} regex
   */
  function wrapMatchesInTextNode(textNode, regex) {
    const text = textNode.nodeValue || '';
    regex.lastIndex = 0;
    if (!regex.test(text)) { return; }
    regex.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const mk = document.createElement('mark');
      mk.className = 'filter-match';
      mk.appendChild(document.createTextNode(m[0]));
      frag.appendChild(mk);
      last = m.index + m[0].length;
      if (m[0].length === 0) {
        regex.lastIndex++;
      }
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    const parent = textNode.parentNode;
    if (parent) {
      parent.replaceChild(frag, textNode);
    }
  }

  /**
   * @param {HTMLElement} entryEl
   * @param {RegExp} regex
   */
  function highlightFilterMatchesInEntry(entryEl, regex) {
    const walker = document.createTreeWalker(entryEl, NodeFilter.SHOW_TEXT, {
      /** @param {Node} node */
      acceptNode(node) {
        const tn = /** @type {Text} */ (node);
        if (!tn.nodeValue) { return NodeFilter.FILTER_REJECT; }
        if (textNodeInsideDartLink(tn)) { return NodeFilter.FILTER_REJECT; }
        if (textNodeInClosedBlockBody(tn)) { return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    /** @type {Text[]} */
    const batch = [];
    let n;
    while ((n = walker.nextNode())) {
      batch.push(/** @type {Text} */ (n));
    }
    for (const tn of batch) {
      wrapMatchesInTextNode(tn, regex);
    }
  }

  /**
   * @param {HTMLElement} mark
   * @returns {{ entry: HTMLElement; ordinal: number } | null}
   */
  function captureMatchPreserveContext(mark) {
    const entry = /** @type {HTMLElement | null} */ (mark.closest('.log-entry'));
    if (!entry) {
      return null;
    }
    const inEntry = filterMatches.filter((m) => entry.contains(m));
    const ordinal = inEntry.indexOf(mark);
    return { entry, ordinal: ordinal >= 0 ? ordinal : 0 };
  }

  /**
   * @param {{ entry: HTMLElement; ordinal: number }} ctx
   * @param {HTMLElement[]} newMatches
   * @returns {number}
   */
  function resolvePreservedMatchIndex(ctx, newMatches) {
    if (!ctx.entry.isConnected || ctx.entry.classList.contains('hidden')) {
      return -1;
    }
    const inEntry = newMatches.filter((m) => ctx.entry.contains(m));
    if (inEntry.length === 0) {
      return -1;
    }
    const ord = Math.min(Math.max(ctx.ordinal, 0), inEntry.length - 1);
    return newMatches.indexOf(inEntry[ord]);
  }

  /**
   * @param {HTMLElement} entry
   * @returns {number}
   */
  function firstGlobalMatchIndexInEntry(entry) {
    for (let i = 0; i < filterMatches.length; i++) {
      if (entry.contains(filterMatches[i])) {
        return i;
      }
    }
    return -1;
  }

  /**
   * @param {number} idx
   * @param {number} len
   * @returns {number}
   */
  function clampGlobalMatchIndex(idx, len) {
    if (len <= 0) {
      return -1;
    }
    return Math.min(Math.max(idx, 0), len - 1);
  }

  function updateFindNavUI() {
    const q = filterInput.value.trim();
    const hasQuery = q.length > 0;
    filterFindNav.hidden = !hasQuery;

    if (!hasQuery) {
      filterMatchCounter.textContent = '';
      btnFilterPrev.disabled = true;
      btnFilterNext.disabled = true;
      return;
    }

    const total = filterMatches.length;
    if (total === 0) {
      filterMatchCounter.textContent = '0 of 0';
      btnFilterPrev.disabled = true;
      btnFilterNext.disabled = true;
      return;
    }

    filterMatchCounter.textContent = filterMatchIndex + 1 + ' of ' + total;
    btnFilterPrev.disabled = false;
    btnFilterNext.disabled = false;
  }

  /**
   * @param {number} delta
   */
  function navigateFilterMatch(delta) {
    flushPendingFindRefresh();

    if (filterMatches.length === 0) { return; }

    filterMatches.forEach((el) => el.classList.remove('filter-match-current'));

    filterMatchIndex = (filterMatchIndex + delta + filterMatches.length) % filterMatches.length;
    const cur = filterMatches[filterMatchIndex];
    cur.classList.add('filter-match-current');
    const row = /** @type {HTMLElement | null} */ (cur.closest('.log-entry'));
    if (row) {
      setSelectedLogEntry(row);
    }
    cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateFindNavUI();
  }

  function refreshFindHighlights() {
    const q = filterInput.value.trim();
    const queryChanged = q !== lastFindHighlightQuery;

    /** @type {{ entry: HTMLElement; ordinal: number } | null} */
    let preserve = null;
    if (
      !queryChanged &&
      filterMatches.length > 0 &&
      filterMatchIndex >= 0 &&
      filterMatchIndex < filterMatches.length
    ) {
      preserve = captureMatchPreserveContext(filterMatches[filterMatchIndex]);
    }

    const prevGlobalIdx = filterMatchIndex;

    stripFilterHighlights(container);

    if (!q) {
      filterMatches = [];
      filterMatchIndex = -1;
      lastFindHighlightQuery = '';
      updateFindNavUI();
      return;
    }

    let regex;
    try {
      regex = new RegExp(escapeRegex(q), 'gi');
    } catch {
      filterMatches = [];
      filterMatchIndex = -1;
      updateFindNavUI();
      return;
    }

    container.querySelectorAll('.log-entry:not(.hidden)').forEach((el) => {
      highlightFilterMatchesInEntry(/** @type {HTMLElement} */ (el), regex);
    });

    filterMatches = Array.from(container.querySelectorAll('mark.filter-match'));

    if (selectedLogEntry && (!selectedLogEntry.isConnected || selectedLogEntry.classList.contains('hidden'))) {
      setSelectedLogEntry(null);
    }

    if (filterMatches.length === 0) {
      filterMatchIndex = -1;
    } else if (queryChanged) {
      filterMatchIndex = 0;
      const entry = /** @type {HTMLElement | null} */ (filterMatches[0].closest('.log-entry'));
      if (entry) {
        setSelectedLogEntry(entry);
      }
    } else {
      let idx = -1;
      if (preserve) {
        idx = resolvePreservedMatchIndex(preserve, filterMatches);
      }
      if (idx >= 0) {
        filterMatchIndex = idx;
      } else if (
        selectedLogEntry &&
        selectedLogEntry.isConnected &&
        !selectedLogEntry.classList.contains('hidden')
      ) {
        const selIx = firstGlobalMatchIndexInEntry(selectedLogEntry);
        filterMatchIndex = selIx >= 0 ? selIx : clampGlobalMatchIndex(prevGlobalIdx, filterMatches.length);
      } else {
        filterMatchIndex = clampGlobalMatchIndex(prevGlobalIdx, filterMatches.length);
      }
    }

    filterMatches.forEach((el) => el.classList.remove('filter-match-current'));
    if (filterMatchIndex >= 0 && filterMatchIndex < filterMatches.length) {
      filterMatches[filterMatchIndex].classList.add('filter-match-current');
    }

    lastFindHighlightQuery = q;
    updateFindNavUI();
  }

  function scheduleRefreshFindHighlights() {
    if (findHighlightTimer !== null) {
      clearTimeout(findHighlightTimer);
    }
    findHighlightTimer = setTimeout(() => {
      findHighlightTimer = null;
      refreshFindHighlights();
    }, 80);
  }

  /** Apply debounced highlight refresh immediately if one is pending (keeps navigation in sync). */
  function flushPendingFindRefresh() {
    if (findHighlightTimer !== null) {
      clearTimeout(findHighlightTimer);
      findHighlightTimer = null;
      refreshFindHighlights();
    }
  }

  // ── Filtering ──

  function applyFilters() {
    const entries = container.querySelectorAll('.log-entry');
    let count = 0;

    entries.forEach((el) => {
      const element = /** @type {HTMLElement} */ (el);
      const category = normalizeCategoryKey(element.dataset.category);
      const source = element.dataset.source || 'flutter';
      const searchText = element.dataset.searchText || '';

      const sourceMatch = source === 'flutter' || showSystemLogs;
      const categoryMatch = entryMatchesFilterMode(category, filterMode);
      const textMatch = !filterText || searchText.includes(filterText);

      if (sourceMatch && categoryMatch && textMatch) {
        element.classList.remove('hidden');
        count++;
      } else {
        element.classList.add('hidden');
      }
    });

    visibleCount = count;
    updateCounter(visibleCount);
    scheduleRefreshFindHighlights();
  }

  /**
   * @param {HTMLElement} el
   * @param {any} entry
   */
  /**
   * @param {HTMLElement} el
   * @param {any} entry
   * @returns {boolean} whether the element is visible
   */
  function applyFilterToElement(el, entry) {
    const source = entry.source || 'flutter';
    const category = normalizeCategoryKey(entry.category);
    const searchText = el.dataset.searchText || '';

    const sourceMatch = source === 'flutter' || showSystemLogs;
    const categoryMatch = entryMatchesFilterMode(category, filterMode);
    const textMatch = !filterText || searchText.includes(filterText);

    if (!sourceMatch || !categoryMatch || !textMatch) {
      el.classList.add('hidden');
      return false;
    }
    return true;
  }

  // ── UI helpers ──

  /**
   * Move focus to a mutex chip so selection matches keyboard focus (unselect leaves focus on old chip otherwise).
   * @param {string} category
   */
  function focusMutexChipByCategory(category) {
    const key = normalizeFilterMode(category);
    const chips = chipBar.querySelectorAll('.chip-filter-option[data-category]');
    for (let i = 0; i < chips.length; i++) {
      const el = /** @type {HTMLElement} */ (chips[i]);
      if (normalizeFilterMode(el.dataset.category) === key && typeof el.focus === 'function') {
        el.focus();
        return;
      }
    }
  }

  function updateChipUI() {
    filterMode = normalizeFilterMode(filterMode);
    chipBar.querySelectorAll('.chip-filter-option[data-category]').forEach((chip) => {
      const el = /** @type {HTMLElement} */ (chip);
      const cat = normalizeFilterMode(el.dataset.category);
      const on = cat === filterMode;
      el.classList.toggle('active', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /**
   * @param {number} [visible]
   */
  function updateCounter(visible) {
    const v = visible !== undefined ? visible : visibleCount;
    counterEl.textContent = `${v} / ${totalCount}`;
  }

  function autoScroll() {
    if (userAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // ── JSON detection & rendering ──

  /**
   * Find matching closing bracket, handling strings correctly.
   * @param {string} text
   * @param {number} startIdx - index of opening { or [
   * @returns {string|null}
   */
  function extractBalancedJson(text, startIdx) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
      const c = text[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\' && inString) { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) { continue; }
      if (c === '{' || c === '[') { depth++; }
      if (c === '}' || c === ']') { depth--; }
      if (depth === 0) { return text.substring(startIdx, i + 1); }
    }
    return null;
  }

  /**
   * Check if text has unbalanced opening braces/brackets (ignoring strings).
   * @param {string} text
   * @returns {boolean}
   */
  function hasUnbalancedBraces(text) {
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) { continue; }
      if (c === '{' || c === '[') { depth++; }
      if (c === '}' || c === ']') { depth--; }
    }
    return depth > 0;
  }

  /**
   * Escape raw newlines that appear inside JSON string values.
   * Log output may split long JSON strings across lines, leaving
   * unescaped \n / \r inside strings which breaks JSON.parse.
   * @param {string} text
   * @returns {string}
   */
  function fixJsonNewlines(text) {
    var result = '';
    var inStr = false;
    var esc = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (esc) { esc = false; result += c; continue; }
      if (c === '\\' && inStr) { esc = true; result += c; continue; }
      if (c === '"') { inStr = !inStr; result += c; continue; }
      if (inStr && c === '\n') { result += '\\n'; continue; }
      if (inStr && c === '\r') { result += '\\r'; continue; }
      result += c;
    }
    return result;
  }

  /**
   * Find first valid JSON object/array in text.
   * Skips nested fragments if the surrounding text has unbalanced braces
   * (indicates a truncated larger JSON structure).
   * @param {string} text
   * @returns {{start: number, end: number, parsed: any}|null}
   */
  function findFirstJson(text) {
    for (var i = 0; i < text.length; i++) {
      if (text[i] === '{' || text[i] === '[') {
        var str = extractBalancedJson(text, i);
        if (str && str.length > 2) {
          try {
            var fixed = fixJsonNewlines(str);
            var parsed = JSON.parse(fixed);
            // If text before the found JSON has unclosed braces,
            // the found JSON is a fragment of a larger truncated structure — skip it
            if (hasUnbalancedBraces(text.substring(0, i))) {
              return null;
            }
            return { start: i, end: i + str.length, parsed: parsed };
          } catch { /* not valid JSON */ }
        }
      }
    }
    return null;
  }

  /**
   * Check if a line has an unclosed JSON string (odd number of unescaped quotes).
   * @param {string} line
   * @returns {boolean}
   */
  function hasUnclosedString(line) {
    var count = 0;
    var esc = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { count++; }
    }
    return count % 2 !== 0;
  }

  /**
   * Fix lines where a JSON string was truncated by a line-length limit
   * (e.g., logcat's ~4096 char limit). Closes the string with …[CROPPED]".
   * @param {string[]} lines
   * @returns {string[]}
   */
  function fixTruncatedJsonLines(lines) {
    return lines.map(function (line, idx) {
      if (!hasUnclosedString(line)) { return line; }
      var fixed = line + '\u2026[CROPPED]"';
      // Add comma if next non-empty line starts a new JSON property/value
      for (var j = idx + 1; j < lines.length; j++) {
        var next = lines[j].trim();
        if (!next) { continue; }
        if (next[0] === '"' || next[0] === '{' || next[0] === '[') {
          fixed += ',';
        }
        break;
      }
      return fixed;
    });
  }

  /**
   * Render block content with JSON detection.
   * @param {string[]} lines - raw lines (with ANSI)
   * @returns {string} HTML
   */
  function renderBlockContent(lines) {
    var cleanLines = fixTruncatedJsonLines(lines.map(function (l) { return stripAnsi(l); }));
    const cleanText = cleanLines.join('\n');
    const jsonInfo = findFirstJson(cleanText);

    if (!jsonInfo) {
      return ansiToHtmlWithDartLinks(lines.join('\n'));
    }

    const { start, end, parsed } = jsonInfo;
    const before = cleanText.substring(0, start);
    const after = cleanText.substring(end);

    let html = '';

    // Text before JSON
    if (before.trim()) {
      html += injectDartSourceLinksHtml(before);
    }

    // JSON as collapsible tree
    html += renderJsonTree(parsed);

    // Text after JSON
    if (after.trim()) {
      html += '\n' + injectDartSourceLinksHtml(after);
    }

    return html;
  }

  /**
   * Render a parsed JSON value as a collapsible tree (entry point).
   * @param {any} value
   * @returns {string} HTML
   */
  function renderJsonTree(value) {
    if (jsonIsFoldable(value)) {
      return renderJsonFold('', value, 0, '');
    }
    if (Array.isArray(value) && value.length === 0) {
      return '<span class="jt-brace">[]</span>';
    }
    if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
      return '<span class="jt-brace">{}</span>';
    }
    return renderJsonPrimitive(value);
  }

  /**
   * @param {any} value
   * @returns {string} HTML
   */
  function renderJsonPrimitive(value) {
    if (value === null) { return '<span class="jt-null">null</span>'; }
    if (typeof value === 'boolean') { return '<span class="jt-bool">' + value + '</span>'; }
    if (typeof value === 'number') { return '<span class="jt-num">' + value + '</span>'; }
    if (typeof value === 'string') {
      return '<span class="jt-str">"' + escapeHtml(value) + '"</span>';
    }
    return escapeHtml(String(value));
  }

  /**
   * @param {any} value
   * @returns {boolean}
   */
  function jsonIsFoldable(value) {
    if (value === null || typeof value !== 'object') { return false; }
    if (Array.isArray(value)) {
      if (value.length === 0) { return false; }
      if (value.length <= 5 && value.every(function (v) { return v === null || typeof v !== 'object'; })) { return false; }
      return true;
    }
    return Object.keys(value).length > 0;
  }

  /**
   * Render a foldable object/array with details/summary.
   * @param {string} prefixHtml - key HTML (empty for root or array items)
   * @param {any} value - object or array
   * @param {number} depth
   * @param {string} comma - trailing comma
   * @returns {string} HTML
   */
  function renderJsonFold(prefixHtml, value, depth, comma) {
    var isArr = Array.isArray(value);
    var ob = isArr ? '[' : '{';
    var cb = isArr ? ']' : '}';
    var count = isArr ? value.length : Object.keys(value).length;
    var label = count + (isArr ? ' items' : (count === 1 ? ' key' : ' keys'));
    var open = depth < 2 ? ' open' : '';

    var childHtml;
    if (isArr) {
      childHtml = value.map(function (v, i) {
        var c = i < value.length - 1 ? ',' : '';
        return renderJsonItem('', v, depth + 1, c);
      }).join('');
    } else {
      var keys = Object.keys(value);
      childHtml = keys.map(function (k, i) {
        var c = i < keys.length - 1 ? ',' : '';
        var kh = '<span class="jt-key">"' + escapeHtml(k) + '"</span>: ';
        return renderJsonItem(kh, value[k], depth + 1, c);
      }).join('');
    }

    return '<details class="jt-fold"' + open + '>'
      + '<summary>' + prefixHtml + '<span class="jt-brace">' + ob + '</span>'
      + '<span class="jt-preview"> \u2026 ' + cb + comma
      + ' <span class="jt-hint">// ' + label + '</span></span></summary>'
      + '<div class="jt-indent">' + childHtml + '</div>'
      + '<span class="jt-close"><span class="jt-brace">' + cb + '</span>' + comma + '</span>'
      + '</details>';
  }

  /**
   * Render a single JSON property or array item.
   * @param {string} prefixHtml - key HTML or empty
   * @param {any} value
   * @param {number} depth
   * @param {string} comma
   * @returns {string} HTML
   */
  function renderJsonItem(prefixHtml, value, depth, comma) {
    if (jsonIsFoldable(value)) {
      return renderJsonFold(prefixHtml, value, depth, comma);
    }
    var html;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        html = '<span class="jt-brace">[]</span>';
      } else {
        var items = value.map(function (v) { return renderJsonPrimitive(v); }).join(', ');
        html = '<span class="jt-brace">[</span>' + items + '<span class="jt-brace">]</span>';
      }
    } else if (typeof value === 'object' && value !== null) {
      html = '<span class="jt-brace">{}</span>';
    } else {
      html = renderJsonPrimitive(value);
    }
    return '<div class="jt-row">' + prefixHtml + html + comma + '</div>';
  }

  // Signal to extension that webview is ready to receive messages
  vscode.postMessage({ command: 'ready' });
})();
