/**
 * Gemini Chat Exporter - Gemini content script
 * Exports Gemini chat conversations to Markdown with LaTeX preservation
 * Version 4.3.0 - DOM-based extraction, selective foldered Gemini batch export
 */

(function() {
  'use strict';

  const CONFIG = {
    BUTTON_ID: 'gemini-export-btn',
    DROPDOWN_ID: 'gemini-export-dropdown',
    BATCH_PROGRESS_ID: 'gemini-batch-progress',
    BATCH_PICKER_ID: 'gemini-batch-picker',
    FILENAME_INPUT_ID: 'gemini-filename-input',
    SELECT_DROPDOWN_ID: 'gemini-select-dropdown',
    CHECKBOX_CLASS: 'gemini-export-checkbox',
    EXPORT_MODE_NAME: 'gemini-export-mode',
    CONFIRM_BTN_ID: 'gemini-export-confirm',
    BATCH_CONFIRM_BTN_ID: 'gemini-export-batch-confirm',
    BATCH_SELECT_BTN_ID: 'gemini-export-batch-select',
    CANCEL_BTN_ID: 'gemini-export-cancel',

    SELECTORS: {
      CHAT_CONTAINER: '[data-test-id="chat-history-container"]',
      CONVERSATION_TURN: 'div.conversation-container',
      USER_QUERY: 'user-query',
      USER_QUERY_TEXT: '.query-text .query-text-line',
      MODEL_RESPONSE: 'model-response',
      MODEL_RESPONSE_CONTENT: 'message-content .markdown',
      CONVERSATION_TITLE: '[data-test-id="conversation-title"]',
      SIDEBAR_SCROLL_CONTAINER: '[data-test-id="overflow-container"]',
      SIDEBAR_INFINITE_SCROLLER: 'infinite-scroller',
      SIDEBAR_CONVERSATION_LINK: 'a[data-test-id="conversation"][href^="/app/"]',
      SIDEBAR_CONVERSATION_TITLE: '.conversation-title',
      SIDEBAR_LOADING_SPINNER: '[data-test-id="loading-history-spinner"]'
    },

    TIMING: {
      SCROLL_DELAY: 2000,
      SIDEBAR_SCROLL_DELAY: 1500,
      NAVIGATION_SETTLE_DELAY: 1200,
      POPUP_DURATION: 2500,
      NOTIFICATION_CLEANUP_DELAY: 1000,
      MAX_SCROLL_ATTEMPTS: 60,
      MAX_STABLE_SCROLLS: 4,
      MAX_SIDEBAR_SCROLL_ATTEMPTS: 80,
      NAVIGATION_TIMEOUT: 30000
    },

    STYLES: {
      BUTTON_PRIMARY: '#1a73e8',
      BUTTON_HOVER: '#1765c1',
      DARK_BG: '#111',
      DARK_TEXT: '#fff',
      DARK_BORDER: '#444',
      LIGHT_BG: '#fff',
      LIGHT_TEXT: '#222',
      LIGHT_BORDER: '#ccc'
    },

    POSITION: {
      BUTTON_TOP: '64px',
      BUTTON_RIGHT: '20px',
      DROPDOWN_TOP: '108px',
      DROPDOWN_RIGHT: '20px'
    },

    MATH_BLOCK_SELECTOR: '.math-block[data-math]',
    MATH_INLINE_SELECTOR: '.math-inline[data-math]',

    FILENAME_PREFIX: 'Gemini',
    EXPORT_TIMESTAMP_LABEL: '导出时间：'
  };

  // ============================================================================
  // UTILITY SERVICES
  // ============================================================================

  class DateUtils {
    static getLocaleString() {
      return new Date().toLocaleString();
    }

    static getFileTimestamp() {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }
  }

  class StringUtils {
    static sanitizeFilename(text) {
      return text
        .replace(/[\\/:*?"<>|.]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    static removeCitations(text) {
      return text
        .replace(/\[cite_start\]/g, '')
        .replace(/\[cite:[\d,\s]+\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    static normalizeWhitespace(text) {
      return (text || '').replace(/\s+/g, ' ').trim();
    }

    static normalizeGeminiPath(href) {
      try {
        const url = new URL(href, window.location.origin);
        const match = url.pathname.match(/^\/app\/([a-zA-Z0-9_-]+)/);
        return match ? `/app/${match[1]}` : '';
      } catch (e) {
        return '';
      }
    }

    static getGeminiConversationId(pathOrHref) {
      const path = this.normalizeGeminiPath(pathOrHref);
      const match = path.match(/^\/app\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : '';
    }
  }

  class DOMUtils {
    static sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    static isDarkMode() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Single updatable progress notification
    static _progressEl = null;
    static _progressSink = null;

    static setProgressSink(fn) {
      this._progressSink = fn;
    }

    static clearProgressSink() {
      this._progressSink = null;
    }

    static showProgress(message) {
      if (this._progressSink) {
        this._progressSink(message);
        return;
      }

      if (this._progressEl && document.body.contains(this._progressEl)) {
        this._progressEl.textContent = message;
        return;
      }
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '99999',
        background: '#1a73e8',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: '8px',
        fontSize: '1em',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        opacity: '0.95',
        pointerEvents: 'none'
      });
      el.textContent = message;
      document.body.appendChild(el);
      this._progressEl = el;
    }

    static hideProgress() {
      if (this._progressSink) return;

      if (this._progressEl) {
        this._progressEl.remove();
        this._progressEl = null;
      }
    }

    static createNotification(message) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '99999',
        background: '#333',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: '8px',
        fontSize: '1em',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        opacity: '0.95',
        pointerEvents: 'none'
      });
      el.textContent = message;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), CONFIG.TIMING.POPUP_DURATION);
      return el;
    }

    static isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        el.getClientRects().length > 0;
    }
  }

  class BatchProgressUI {
    constructor({ onPauseToggle, onCancel }) {
      this.onPauseToggle = onPauseToggle;
      this.onCancel = onCancel;
      this.isPaused = false;
      this.el = this._create();
      document.body.appendChild(this.el);
    }

    _create() {
      document.getElementById(CONFIG.BATCH_PROGRESS_ID)?.remove();

      const isDark = DOMUtils.isDarkMode();
      const el = document.createElement('div');
      el.id = CONFIG.BATCH_PROGRESS_ID;
      Object.assign(el.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '100000',
        width: '360px',
        padding: '12px 14px',
        borderRadius: '8px',
        border: `1px solid ${isDark ? '#444' : '#ddd'}`,
        background: isDark ? '#202124' : '#fff',
        color: isDark ? '#fff' : '#222',
        boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
        fontSize: '13px',
        lineHeight: '1.45'
      });

      el.innerHTML = `
        <div data-role="main" style="font-weight:bold;margin-bottom:6px;">准备批量导出…</div>
        <div data-role="stats" style="color:${isDark ? '#ccc' : '#555'};margin-bottom:6px;"></div>
        <div data-role="detail" style="color:${isDark ? '#aaa' : '#777'};word-break:break-word;margin-bottom:10px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button data-role="pause" style="padding:5px 10px;border-radius:5px;border:1px solid ${CONFIG.STYLES.BUTTON_PRIMARY};background:transparent;color:${CONFIG.STYLES.BUTTON_PRIMARY};cursor:pointer;">暂停</button>
          <button data-role="cancel" style="padding:5px 10px;border-radius:5px;border:1px solid #c5221f;background:transparent;color:#c5221f;cursor:pointer;">中止</button>
        </div>
      `;

      el.querySelector('[data-role="pause"]').addEventListener('click', () => {
        this.isPaused = !this.isPaused;
        el.querySelector('[data-role="pause"]').textContent = this.isPaused ? '继续' : '暂停';
        this.onPauseToggle?.(this.isPaused);
      });
      el.querySelector('[data-role="cancel"]').addEventListener('click', () => this.onCancel?.());

      return el;
    }

    update({ phase, current = 0, total = 0, success = 0, failed = 0, found = 0, title = '', folderName = '', detail = '' }) {
      if (!this.el || !document.body.contains(this.el)) return;

      const main = this.el.querySelector('[data-role="main"]');
      const stats = this.el.querySelector('[data-role="stats"]');
      const detailEl = this.el.querySelector('[data-role="detail"]');

      if (phase === 'scan') {
        main.textContent = '正在扫描 Gemini 左侧历史记录';
        stats.textContent = `已发现 ${found} 个对话`;
      } else if (phase === 'export') {
        main.textContent = `正在导出 ${current} / ${total}${title ? `：${title}` : ''}`;
        stats.textContent = `成功 ${success}，失败 ${failed}，剩余 ${Math.max(total - current, 0)}${folderName ? `｜${folderName}/` : ''}`;
      } else if (phase === 'paused') {
        main.textContent = '批量导出已暂停';
        stats.textContent = `成功 ${success}，失败 ${failed}，总数 ${total}`;
      } else if (phase === 'cancel') {
        main.textContent = '正在中止批量导出…';
      } else if (phase === 'done') {
        main.textContent = '批量导出完成';
        stats.textContent = `成功 ${success}，失败 ${failed}，总数 ${total}${folderName ? `｜${folderName}/` : ''}`;
      }

      if (detail !== undefined) {
        detailEl.textContent = detail || '';
      }
    }

    setDetail(message) {
      const detailEl = this.el?.querySelector('[data-role="detail"]');
      if (detailEl) detailEl.textContent = message || '';
    }

    dispose(delay = 0) {
      const remove = () => {
        this.el?.remove();
        this.el = null;
      };

      if (delay > 0) {
        setTimeout(remove, delay);
      } else {
        remove();
      }
    }
  }

  class BatchSelectionDialog {
    static open(conversations) {
      return new Promise(resolve => {
        const dialog = new BatchSelectionDialog(conversations, resolve);
        dialog.show();
      });
    }

    constructor(conversations, resolve) {
      this.conversations = conversations;
      this.resolve = resolve;
      this.selectedPaths = new Set();
      this.lastClickedIndex = null;
      this.searchText = '';
      this.el = null;
    }

    show() {
      document.getElementById(CONFIG.BATCH_PICKER_ID)?.remove();
      this.el = this._create();
      document.body.appendChild(this.el);
      this.renderList();
      this.updateCount();
    }

    _create() {
      const isDark = DOMUtils.isDarkMode();
      const overlay = document.createElement('div');
      overlay.id = CONFIG.BATCH_PICKER_ID;
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '100001',
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px'
      });

      const panel = document.createElement('div');
      Object.assign(panel.style, {
        width: '720px',
        maxWidth: 'calc(100vw - 48px)',
        height: 'min(760px, calc(100vh - 56px))',
        background: isDark ? '#202124' : '#fff',
        color: isDark ? '#fff' : '#222',
        border: `1px solid ${isDark ? '#444' : '#ddd'}`,
        borderRadius: '8px',
        boxShadow: '0 12px 36px rgba(0,0,0,0.28)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      });

      const inputStyle = UIBuilder.getInputStyles(isDark);
      panel.innerHTML = `
        <div style="padding:14px 16px;border-bottom:1px solid ${isDark ? '#333' : '#eee'};">
          <div style="font-weight:bold;font-size:1.05em;margin-bottom:8px;">选择要导出的 Gemini 对话</div>
          <div style="display:grid;grid-template-columns:1fr 210px;gap:8px;margin-bottom:8px;">
            <input data-role="search" type="text" placeholder="搜索标题或对话 ID" style="padding:6px 10px;box-sizing:border-box;${inputStyle}">
            <input data-role="range" type="text" placeholder="序号范围，如 1-5,8" style="padding:6px 10px;box-sizing:border-box;${inputStyle}">
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button data-action="all">全选</button>
            <button data-action="none">清空</button>
            <button data-action="invert">反选</button>
            <button data-action="replace-range">替换为范围</button>
            <button data-action="append-range">追加范围</button>
            <span data-role="count" style="margin-left:auto;color:${isDark ? '#ccc' : '#666'};"></span>
          </div>
          <div style="font-size:0.82em;color:${isDark ? '#aaa' : '#777'};margin-top:6px;">
            范围输入只在点击“替换为范围”或“追加范围”时生效；最终以列表勾选为准。支持 Shift 连续选择。
          </div>
        </div>
        <div data-role="list" style="flex:1;overflow:auto;padding:8px 0;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid ${isDark ? '#333' : '#eee'};">
          <button data-action="cancel">取消</button>
          <button data-action="export" style="background:${CONFIG.STYLES.BUTTON_PRIMARY};color:#fff;border-color:${CONFIG.STYLES.BUTTON_PRIMARY};font-weight:bold;">导出选中</button>
        </div>
      `;

      panel.querySelectorAll('button').forEach(button => {
        Object.assign(button.style, {
          padding: '6px 10px',
          borderRadius: '5px',
          border: `1px solid ${isDark ? '#555' : '#ccc'}`,
          background: button.dataset.action === 'export' ? CONFIG.STYLES.BUTTON_PRIMARY : 'transparent',
          color: button.dataset.action === 'export' ? '#fff' : (isDark ? '#fff' : '#333'),
          cursor: 'pointer'
        });
      });

      overlay.appendChild(panel);
      this._bind(panel);
      return overlay;
    }

    _bind(panel) {
      panel.querySelector('[data-role="search"]').addEventListener('input', e => {
        this.searchText = StringUtils.normalizeWhitespace(e.target.value).toLowerCase();
        this.renderList();
      });

      panel.querySelector('[data-action="all"]').addEventListener('click', () => {
        this._visibleConversations().forEach(({ entry }) => this.selectedPaths.add(entry.path));
        this.renderList();
        this.updateCount();
      });
      panel.querySelector('[data-action="none"]').addEventListener('click', () => {
        this._visibleConversations().forEach(({ entry }) => this.selectedPaths.delete(entry.path));
        this.renderList();
        this.updateCount();
      });
      panel.querySelector('[data-action="invert"]').addEventListener('click', () => {
        this._visibleConversations().forEach(({ entry }) => {
          if (this.selectedPaths.has(entry.path)) {
            this.selectedPaths.delete(entry.path);
          } else {
            this.selectedPaths.add(entry.path);
          }
        });
        this.renderList();
        this.updateCount();
      });
      panel.querySelector('[data-action="replace-range"]').addEventListener('click', () => {
        const indexes = this._parseRange(panel.querySelector('[data-role="range"]').value);
        if (!indexes.size) return;
        this.selectedPaths.clear();
        indexes.forEach(index => this.selectedPaths.add(this.conversations[index].path));
        this.renderList();
        this.updateCount();
      });
      panel.querySelector('[data-action="append-range"]').addEventListener('click', () => {
        const indexes = this._parseRange(panel.querySelector('[data-role="range"]').value);
        if (!indexes.size) return;
        indexes.forEach(index => this.selectedPaths.add(this.conversations[index].path));
        this.renderList();
        this.updateCount();
      });
      panel.querySelector('[data-action="cancel"]').addEventListener('click', () => this.close(null));
      panel.querySelector('[data-action="export"]').addEventListener('click', () => {
        const selected = this.conversations.filter(entry => this.selectedPaths.has(entry.path));
        if (!selected.length) {
          alert('请至少选择一个对话。');
          return;
        }
        this.close(selected);
      });
    }

    renderList() {
      const list = this.el.querySelector('[data-role="list"]');
      const isDark = DOMUtils.isDarkMode();
      const visible = this._visibleConversations();

      if (!visible.length) {
        list.innerHTML = `<div style="padding:18px;color:${isDark ? '#aaa' : '#777'};">没有匹配的对话。</div>`;
        return;
      }

      list.innerHTML = '';
      visible.forEach(({ entry, index }) => {
        const row = document.createElement('label');
        Object.assign(row.style, {
          display: 'grid',
          gridTemplateColumns: '28px 56px 1fr',
          gap: '8px',
          alignItems: 'center',
          padding: '8px 16px',
          cursor: 'pointer',
          borderBottom: `1px solid ${isDark ? '#2b2c2f' : '#f0f0f0'}`
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.selectedPaths.has(entry.path);
        checkbox.addEventListener('click', e => {
          e.stopPropagation();
          this._toggleIndex(index, checkbox.checked, e.shiftKey);
        });

        const number = document.createElement('div');
        number.textContent = String(index + 1);
        number.style.color = isDark ? '#aaa' : '#777';

        const title = document.createElement('div');
        title.innerHTML = `<div style="font-weight:500;word-break:break-word;"></div><div style="font-size:0.82em;color:${isDark ? '#aaa' : '#777'};word-break:break-all;"></div>`;
        title.children[0].textContent = entry.title || entry.path;
        title.children[1].textContent = entry.path;

        row.appendChild(checkbox);
        row.appendChild(number);
        row.appendChild(title);
        row.addEventListener('click', e => {
          const nextChecked = !this.selectedPaths.has(entry.path);
          this._toggleIndex(index, nextChecked, e.shiftKey);
        });

        list.appendChild(row);
      });
    }

    _toggleIndex(index, checked, shiftKey) {
      if (shiftKey && this.lastClickedIndex !== null) {
        const start = Math.min(this.lastClickedIndex, index);
        const end = Math.max(this.lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          if (checked) {
            this.selectedPaths.add(this.conversations[i].path);
          } else {
            this.selectedPaths.delete(this.conversations[i].path);
          }
        }
      } else if (checked) {
        this.selectedPaths.add(this.conversations[index].path);
      } else {
        this.selectedPaths.delete(this.conversations[index].path);
      }

      this.lastClickedIndex = index;
      this.renderList();
      this.updateCount();
    }

    _visibleConversations() {
      return this.conversations
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => {
          if (!this.searchText) return true;
          return `${entry.title} ${entry.path} ${entry.id}`.toLowerCase().includes(this.searchText);
        });
    }

    _parseRange(value) {
      const result = new Set();
      const max = this.conversations.length;
      const parts = String(value || '').split(',').map(part => part.trim()).filter(Boolean);

      parts.forEach(part => {
        const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) return;

        let start = Number(match[1]);
        let end = Number(match[2] || match[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        if (start > end) [start, end] = [end, start];

        start = Math.max(1, Math.min(max, start));
        end = Math.max(1, Math.min(max, end));
        for (let i = start; i <= end; i++) result.add(i - 1);
      });

      if (!result.size) {
        alert('未识别到有效序号范围。示例：1-5,8,12-20');
      }

      return result;
    }

    updateCount() {
      const count = this.el?.querySelector('[data-role="count"]');
      if (count) count.textContent = `已选择 ${this.selectedPaths.size} / ${this.conversations.length}`;
    }

    close(value) {
      this.el?.remove();
      this.el = null;
      this.resolve(value);
    }
  }

  // ============================================================================
  // FILENAME SERVICE
  // ============================================================================

  class FilenameService {
    static getConversationTitle() {
      const titleCard = document.querySelector(CONFIG.SELECTORS.CONVERSATION_TITLE);
      return titleCard ? titleCard.textContent.trim() : '';
    }

    static generate(customFilename, conversationTitle) {
      const prefix = CONFIG.FILENAME_PREFIX;

      if (customFilename && customFilename.trim()) {
        const base = this._sanitizeCustomFilename(customFilename);
        return base ? `${prefix}_${base}` : prefix;
      }

      if (conversationTitle) {
        const safeTitle = StringUtils.sanitizeFilename(conversationTitle);
        if (safeTitle) return `${prefix}_${safeTitle}`;
      }

      const pageTitle = document.querySelector('title')?.textContent.trim();
      if (pageTitle) {
        const safeTitle = StringUtils.sanitizeFilename(pageTitle);
        if (safeTitle) return `${prefix}_${safeTitle}`;
      }

      return prefix;
    }

    static generateBatchFolder(customFilename) {
      const prefix = CONFIG.FILENAME_PREFIX;

      if (customFilename && customFilename.trim()) {
        const base = this._sanitizeCustomFilename(customFilename);
        return base ? `${prefix}_${base}` : `${prefix}_All_Chats_${DateUtils.getFileTimestamp()}`;
      }

      return `${prefix}_All_Chats_${DateUtils.getFileTimestamp()}`;
    }

    static generateBatchConversationFile(entry, index, totalCount, usedFilenames) {
      const width = Math.max(2, String(totalCount).length);
      const ordinal = String(index).padStart(width, '0');
      const safeTitle = this._sanitizeCustomFilename(entry.title || '').slice(0, 100);
      const fallback = entry.id || `conversation_${ordinal}`;
      let base = `${ordinal}_${safeTitle || fallback}`;
      let filename = `${base}.md`;
      let suffix = 2;

      while (usedFilenames.has(filename)) {
        filename = `${base}_${suffix}.md`;
        suffix++;
      }

      usedFilenames.add(filename);
      return filename;
    }

    static _sanitizeCustomFilename(filename) {
      const base = filename.trim().replace(/\.[^/.]+$/, '');
      // Allow ASCII alphanumeric, dash, underscore, and CJK characters
      return base.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff\u3040-\u30ff]/g, '_');
    }
  }

  // ============================================================================
  // SCROLL SERVICE
  // ============================================================================

  class ScrollService {
    static async loadAllMessages() {
      const scrollContainer = document.querySelector(CONFIG.SELECTORS.CHAT_CONTAINER);
      if (!scrollContainer) {
        throw new Error('未找到对话容器，请确认当前页面为 Gemini 对话页面。');
      }

      let stableScrolls = 0;
      let scrollAttempts = 0;
      let lastScrollTop = null;

      while (stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS &&
             scrollAttempts < CONFIG.TIMING.MAX_SCROLL_ATTEMPTS) {
        const currentTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        DOMUtils.showProgress(`正在加载历史消息… 第 ${scrollAttempts + 1} 次，已找到 ${currentTurnCount} 轮对话`);

        scrollContainer.scrollTop = 0;
        await DOMUtils.sleep(CONFIG.TIMING.SCROLL_DELAY);

        const scrollTop = scrollContainer.scrollTop;
        const newTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;

        if (newTurnCount === currentTurnCount && (lastScrollTop === scrollTop || scrollTop === 0)) {
          stableScrolls++;
        } else {
          stableScrolls = 0;
        }

        lastScrollTop = scrollTop;
        scrollAttempts++;
      }

      DOMUtils.hideProgress();
    }
  }

  // ============================================================================
  // SIDEBAR CONVERSATION SERVICE
  // ============================================================================

  class SidebarConversationService {
    static getScrollContainer() {
      const roots = [
        document.querySelector(CONFIG.SELECTORS.SIDEBAR_SCROLL_CONTAINER),
        document.querySelector(CONFIG.SELECTORS.SIDEBAR_INFINITE_SCROLLER)
      ].filter(Boolean);

      for (const root of roots) {
        const scrollable = this._findScrollableElement(root);
        if (scrollable) return scrollable;
      }

      return roots[0] || null;
    }

    static _findScrollableElement(root) {
      const candidates = [root, ...Array.from(root.querySelectorAll('*'))];

      return candidates.find(el => {
        const style = window.getComputedStyle(el);
        const canScroll = /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
        return canScroll && el.scrollHeight > el.clientHeight + 8;
      }) || null;
    }

    static _scrollContainer(container, direction = 'down') {
      const delta = direction === 'up'
        ? -Math.max(container.clientHeight, 700)
        : Math.max(container.clientHeight, 700);

      if (typeof container.scrollBy === 'function') {
        container.scrollBy({ top: delta, behavior: 'auto' });
      } else {
        container.scrollTop += delta;
      }

      container.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: delta
      }));
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
    }

    static getCurrentConversationPath() {
      return StringUtils.normalizeGeminiPath(window.location.href);
    }

    static getConversationSignature() {
      const title = FilenameService.getConversationTitle();
      const firstTurn = document.querySelector(CONFIG.SELECTORS.CONVERSATION_TURN);
      const turnText = firstTurn ? firstTurn.textContent.slice(0, 300) : '';
      return StringUtils.normalizeWhitespace(`${title} ${turnText}`);
    }

    static getConversationLinks() {
      const links = new Map();
      const anchors = document.querySelectorAll(CONFIG.SELECTORS.SIDEBAR_CONVERSATION_LINK);

      anchors.forEach(anchor => {
        const path = StringUtils.normalizeGeminiPath(anchor.getAttribute('href') || '');
        if (!path || links.has(path)) return;

        const title = this._extractTitle(anchor);
        links.set(path, {
          id: StringUtils.getGeminiConversationId(path),
          path,
          url: new URL(path, window.location.origin).href,
          title: title || path
        });
      });

      return Array.from(links.values());
    }

    static _extractTitle(anchor) {
      const titleEl = anchor.querySelector(CONFIG.SELECTORS.SIDEBAR_CONVERSATION_TITLE);
      if (!titleEl) return StringUtils.normalizeWhitespace(anchor.textContent);

      const clone = titleEl.cloneNode(true);
      clone.querySelectorAll('.conversation-title-cover').forEach(el => el.remove());
      return StringUtils.normalizeWhitespace(clone.textContent);
    }

    static async loadAllConversationLinks({ onProgress, shouldStop } = {}) {
      const scrollContainer = this.getScrollContainer();
      if (!scrollContainer) {
        throw new Error('未找到 Gemini 侧边栏历史记录容器。请展开左侧边栏后重试。');
      }

      let stableScrolls = 0;
      let scrollAttempts = 0;
      let lastCount = -1;
      let lastScrollHeight = -1;
      const allLinks = new Map();

      while (stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS &&
             scrollAttempts < CONFIG.TIMING.MAX_SIDEBAR_SCROLL_ATTEMPTS) {
        if (shouldStop?.()) {
          const error = new Error('批量导出已中止。');
          error.name = 'BatchCancelledError';
          throw error;
        }

        this.getConversationLinks().forEach(entry => allLinks.set(entry.path, entry));
        const progressMessage = `正在扫描侧边栏历史对话… 第 ${scrollAttempts + 1} 次，已找到 ${allLinks.size} 个`;
        DOMUtils.showProgress(progressMessage);
        onProgress?.({ attempt: scrollAttempts + 1, found: allLinks.size, message: progressMessage });

        this._scrollContainer(scrollContainer, 'down');
        await DOMUtils.sleep(CONFIG.TIMING.SIDEBAR_SCROLL_DELAY);

        this.getConversationLinks().forEach(entry => allLinks.set(entry.path, entry));
        const spinners = Array.from(document.querySelectorAll(CONFIG.SELECTORS.SIDEBAR_LOADING_SPINNER));
        const spinnerVisible = spinners.some(spinner => DOMUtils.isVisible(spinner));
        const isStable = allLinks.size === lastCount &&
          scrollContainer.scrollHeight === lastScrollHeight &&
          !spinnerVisible;

        stableScrolls = isStable ? stableScrolls + 1 : 0;
        lastCount = allLinks.size;
        lastScrollHeight = scrollContainer.scrollHeight;
        scrollAttempts++;
      }

      this.getConversationLinks().forEach(entry => allLinks.set(entry.path, entry));
      const links = Array.from(allLinks.values());
      DOMUtils.hideProgress();

      if (!links.length) {
        throw new Error('未在侧边栏找到可导出的 Gemini 历史对话。');
      }

      return links;
    }

    static async scrollToTop() {
      const scrollContainer = this.getScrollContainer();
      if (!scrollContainer) return;

      let attempts = 0;
      while (scrollContainer.scrollTop > 0 && attempts < CONFIG.TIMING.MAX_SIDEBAR_SCROLL_ATTEMPTS) {
        this._scrollContainer(scrollContainer, 'up');
        await DOMUtils.sleep(100);
        attempts++;
      }
    }

    static async ensureAnchorVisible(path) {
      let anchor = this.findAnchorByPath(path);
      if (anchor) return anchor;

      const scrollContainer = this.getScrollContainer();
      if (!scrollContainer) return null;

      await this.scrollToTop();

      let attempts = 0;
      let lastScrollTop = -1;
      let stableScrolls = 0;

      while (attempts < CONFIG.TIMING.MAX_SIDEBAR_SCROLL_ATTEMPTS &&
             stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS) {
        anchor = this.findAnchorByPath(path);
        if (anchor) return anchor;

        DOMUtils.showProgress(`正在定位侧边栏对话入口… 第 ${attempts + 1} 次`);
        this._scrollContainer(scrollContainer, 'down');
        await DOMUtils.sleep(300);

        if (scrollContainer.scrollTop === lastScrollTop) {
          stableScrolls++;
        } else {
          stableScrolls = 0;
        }

        lastScrollTop = scrollContainer.scrollTop;
        attempts++;
      }

      return this.findAnchorByPath(path);
    }

    static findAnchorByPath(path) {
      const id = StringUtils.getGeminiConversationId(path);
      if (!id) return null;

      return Array.from(document.querySelectorAll(CONFIG.SELECTORS.SIDEBAR_CONVERSATION_LINK))
        .find(anchor => StringUtils.getGeminiConversationId(anchor.getAttribute('href') || '') === id) || null;
    }

    static async openConversation(entry) {
      const targetPath = entry.path;
      if (this.getCurrentConversationPath() === targetPath) {
        await DOMUtils.sleep(CONFIG.TIMING.NAVIGATION_SETTLE_DELAY);
        return;
      }

      const anchor = await this.ensureAnchorVisible(targetPath);
      if (!anchor) {
        throw new Error(`侧边栏中找不到对话入口：${entry.title}`);
      }

      const previousSignature = this.getConversationSignature();
      anchor.click();
      await this.waitForConversation(targetPath, previousSignature);
    }

    static async waitForConversation(targetPath, previousSignature = '') {
      const startedAt = Date.now();

      while (Date.now() - startedAt < CONFIG.TIMING.NAVIGATION_TIMEOUT) {
        const pathMatches = this.getCurrentConversationPath() === targetPath;
        const hasChat = !!document.querySelector(CONFIG.SELECTORS.CHAT_CONTAINER);
        const hasTurns = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length > 0;

        if (pathMatches && hasChat && hasTurns) {
          await DOMUtils.sleep(CONFIG.TIMING.NAVIGATION_SETTLE_DELAY);
          const nextSignature = this.getConversationSignature();
          if (!previousSignature || nextSignature !== previousSignature) {
            return;
          }
        }

        await DOMUtils.sleep(500);
      }

      throw new Error(`等待对话加载超时：${targetPath}`);
    }
  }

  // ============================================================================
  // FILE EXPORT SERVICE
  // ============================================================================

  class FileExportService {
    static downloadMarkdown(markdown, filenameBase) {
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenameBase}.md`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, CONFIG.TIMING.NOTIFICATION_CLEANUP_DELAY);
    }

    static async exportToClipboard(markdown) {
      await navigator.clipboard.writeText(markdown);
      DOMUtils.createNotification('✓ 已复制到剪贴板！');
    }

    static async downloadMarkdownToFolder(markdown, folderName, filename) {
      if (!chrome?.runtime?.sendMessage) {
        throw new Error('当前环境无法调用扩展下载服务。');
      }

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'downloadMarkdownFile',
          payload: {
            folderName,
            filename,
            content: markdown
          }
        }, result => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }

          resolve(result);
        });
      });

      if (!response?.ok) {
        throw new Error(response?.error || `下载失败：${filename}`);
      }

      return response.downloadId;
    }
  }

  // ============================================================================
  // MARKDOWN CONVERTER SERVICE
  // ============================================================================

  class MarkdownConverter {
    constructor() {
      this.turndownService = this._createTurndownService();
    }

    _createTurndownService() {
      if (typeof window.TurndownService !== 'function') {
        return null;
      }

      const service = new window.TurndownService({
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockFence: '```'
      });

      service.addRule('mathBlock', {
        filter: node => node.nodeType === 1 && node.matches?.(CONFIG.MATH_BLOCK_SELECTOR),
        replacement: (content, node) => {
          const latex = node.getAttribute('data-math') || '';
          return `$$${latex}$$\n\n`;
        }
      });

      service.addRule('mathInline', {
        filter: node => node.nodeType === 1 && node.matches?.(CONFIG.MATH_INLINE_SELECTOR),
        replacement: (content, node) => {
          const latex = node.getAttribute('data-math') || '';
          return `$${latex}$`;
        }
      });

      service.addRule('table', {
        filter: 'table',
        replacement: (content, node) => {
          const rows = Array.from(node.querySelectorAll('tr'));
          if (!rows.length) return '';

          const getCells = row => {
            return Array.from(row.querySelectorAll('th, td')).map(cell => {
              const cellContent = service.turndown(cell.innerHTML);
              return cellContent.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
            });
          };

          const headerRow = rows[0];
          const headers = getCells(headerRow);
          const separator = headers.map(() => '---');
          const bodyRows = rows.slice(1).map(getCells);

          const lines = [
            `| ${headers.join(' | ')} |`,
            `| ${separator.join(' | ')} |`,
            ...bodyRows.map(cells => `| ${cells.join(' | ')} |`)
          ];

          return `\n${lines.join('\n')}\n\n`;
        }
      });

      service.addRule('lineBreak', {
        filter: 'br',
        replacement: () => '  \n'
      });

      return service;
    }

    extractUserQuery(userQueryElement) {
      if (!userQueryElement) return '';

      const parts = [];

      // Detect image / file attachments and insert placeholder
      const attachmentImgs = userQueryElement.querySelectorAll(
        'img:not([aria-hidden="true"]):not([role="presentation"])'
      );
      const attachmentChips = userQueryElement.querySelectorAll(
        '[data-test-id*="file"], [class*="attachment"], [class*="file-chip"], [class*="image-chip"]'
      );
      const attachCount = attachmentImgs.length + attachmentChips.length;
      if (attachCount > 0) {
        parts.push(`[📎 图片/文件附件 ×${attachCount}]`);
      }

      const queryLines = userQueryElement.querySelectorAll(CONFIG.SELECTORS.USER_QUERY_TEXT);
      if (queryLines.length === 0) {
        const queryText = userQueryElement.querySelector('.query-text, .user-query-container');
        if (queryText) parts.push(queryText.textContent.trim());
      } else {
        const text = Array.from(queryLines)
          .map(line => line.textContent.trim())
          .filter(t => t.length > 0)
          .join('\n');
        if (text) parts.push(text);
      }

      return parts.join('\n\n');
    }

    extractModelResponse(modelResponseElement) {
      if (!modelResponseElement) return '';

      const markdownContainer = modelResponseElement.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE_CONTENT);
      if (!markdownContainer) return '';

      let result = '';
      if (this.turndownService) {
        result = this.turndownService.turndown(markdownContainer.innerHTML);
      } else {
        result = FallbackConverter.convertToMarkdown(markdownContainer);
      }

      return StringUtils.removeCitations(result);
    }
  }

  // ============================================================================
  // FALLBACK CONVERTER (when Turndown unavailable)
  // ============================================================================

  class FallbackConverter {
    static convertToMarkdown(container) {
      return Array.from(container.childNodes).map(node => this._blockText(node)).join('');
    }

    static _inlineText(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const el = node;
      if (el.matches?.(CONFIG.MATH_INLINE_SELECTOR)) {
        return `$${el.getAttribute('data-math') || ''}$`;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      if (tag === 'b' || tag === 'strong') {
        return `**${Array.from(el.childNodes).map(n => this._inlineText(n)).join('')}**`;
      }
      if (tag === 'i' || tag === 'em') {
        return `*${Array.from(el.childNodes).map(n => this._inlineText(n)).join('')}*`;
      }
      if (tag === 'code') return `\`${el.textContent || ''}\``;

      return Array.from(el.childNodes).map(n => this._inlineText(n)).join('');
    }

    static _blockText(el) {
      if (!el) return '';
      if (el.nodeType === Node.TEXT_NODE) return (el.textContent || '').trim();
      if (el.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = el.tagName.toLowerCase();

      if (el.matches?.(CONFIG.MATH_BLOCK_SELECTOR)) {
        return `$$${el.getAttribute('data-math') || ''}$$\n\n`;
      }

      const handlers = {
        h1: () => `# ${this._inlineText(el)}\n\n`,
        h2: () => `## ${this._inlineText(el)}\n\n`,
        h3: () => `### ${this._inlineText(el)}\n\n`,
        h4: () => `#### ${this._inlineText(el)}\n\n`,
        h5: () => `##### ${this._inlineText(el)}\n\n`,
        h6: () => `###### ${this._inlineText(el)}\n\n`,
        p:  () => `${this._inlineText(el)}\n\n`,
        hr: () => `---\n\n`,
        blockquote: () => this._convertBlockquote(el),
        pre: () => {
          const codeEl = el.querySelector('code');
          const lang = codeEl?.className?.match(/language-(\S+)/)?.[1] || '';
          return `\`\`\`${lang}\n${el.textContent || ''}\n\`\`\`\n\n`;
        },
        ul: () => this._convertList(el, false),
        ol: () => this._convertList(el, true),
        table: () => this._convertTable(el)
      };

      if (handlers[tag]) return handlers[tag]();

      return Array.from(el.childNodes).map(n => this._blockText(n)).join('');
    }

    static _convertBlockquote(el) {
      const lines = Array.from(el.childNodes).map(n => this._blockText(n)).join('').trim().split('\n');
      return lines.map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
    }

    static _convertList(el, isOrdered) {
      const items = Array.from(el.querySelectorAll(':scope > li'));
      const converted = items.map((li, i) => {
        const marker = isOrdered ? `${i + 1}.` : '-';
        return `${marker} ${this._inlineText(li).trim()}`;
      }).join('\n');
      return `${converted}\n\n`;
    }

    static _convertTable(el) {
      const rows = Array.from(el.querySelectorAll('tr'));
      if (!rows.length) return '';

      const getCells = row => Array.from(row.querySelectorAll('th,td'))
        .map(cell => this._inlineText(cell).replace(/\n/g, ' ').trim());

      const header = getCells(rows[0]);
      const separator = header.map(() => '---');
      const body = rows.slice(1).map(getCells);

      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${separator.join(' | ')} |`,
        ...body.map(r => `| ${r.join(' | ')} |`)
      ];
      return `${lines.join('\n')}\n\n`;
    }
  }

  // ============================================================================
  // CHECKBOX MANAGER
  // ============================================================================

  class CheckboxManager {
    createCheckbox(type, container) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = CONFIG.CHECKBOX_CLASS;
      cb.checked = true;
      cb.title = `将此${type}消息包含在导出中`;

      Object.assign(cb.style, {
        position: 'absolute',
        right: '28px',
        top: '8px',
        zIndex: '10000',
        transform: 'scale(1.2)'
      });

      container.style.position = 'relative';
      container.appendChild(cb);
      return cb;
    }

    injectCheckboxes() {
      const turns = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN);

      turns.forEach(turn => {
        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem && !userQueryElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`)) {
          this.createCheckbox('用户', userQueryElem);
        }

        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem && !modelRespElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`)) {
          this.createCheckbox('Gemini', modelRespElem);
        }
      });
    }

    removeAll() {
      document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.remove());
    }

    hasAnyChecked() {
      return Array.from(document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`))
        .some(cb => cb.checked);
    }
  }

  // ============================================================================
  // SELECTION MANAGER
  // ============================================================================

  class SelectionManager {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
      this.lastSelection = 'all';
    }

    applySelection(value) {
      const checkboxes = document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`);

      switch (value) {
        case 'all':
          checkboxes.forEach(cb => cb.checked = true);
          break;
        case 'ai':
          document.querySelectorAll(`${CONFIG.SELECTORS.USER_QUERY} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = false);
          document.querySelectorAll(`${CONFIG.SELECTORS.MODEL_RESPONSE} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = true);
          break;
        case 'none':
          checkboxes.forEach(cb => cb.checked = false);
          break;
      }

      this.lastSelection = value;
    }

    reset() {
      this.lastSelection = 'all';
      const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (select) select.value = 'all';
    }

    // Re-apply the current selection to any newly-loaded messages
    reapplyIfNeeded() {
      const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (select && this.lastSelection !== 'custom') {
        select.value = this.lastSelection;
        this.applySelection(this.lastSelection);
      }
    }
  }

  // ============================================================================
  // UI BUILDER
  // ============================================================================

  class UIBuilder {
    static getInputStyles(isDark) {
      return isDark
        ? `background:${CONFIG.STYLES.DARK_BG};color:${CONFIG.STYLES.DARK_TEXT};border:1px solid ${CONFIG.STYLES.DARK_BORDER};border-radius:4px;`
        : `background:${CONFIG.STYLES.LIGHT_BG};color:${CONFIG.STYLES.LIGHT_TEXT};border:1px solid ${CONFIG.STYLES.LIGHT_BORDER};border-radius:4px;`;
    }

    static createDropdownHTML(isDark) {
      const inputStyles = this.getInputStyles(isDark);
      const confirmStyle = `padding:7px 20px;background:${CONFIG.STYLES.BUTTON_PRIMARY};color:#fff;border:none;border-radius:5px;font-size:0.95em;font-weight:bold;cursor:pointer;`;
      const cancelStyle  = `padding:7px 14px;background:transparent;color:${isDark ? '#aaa' : '#666'};border:1px solid ${isDark ? '#555' : '#ccc'};border-radius:5px;font-size:0.95em;cursor:pointer;`;

      return `
        <div style="font-weight:bold;font-size:1.05em;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid ${isDark ? '#333' : '#eee'};">
          导出设置
        </div>
        <div style="margin-bottom:10px;">
          <label style="margin-right:14px;cursor:pointer;">
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="file" checked>
            导出为文件
          </label>
          <label style="cursor:pointer;">
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="clipboard">
            复制到剪贴板
          </label>
        </div>
        <div id="gemini-filename-row" style="margin-bottom:10px;">
          <div style="font-weight:bold;margin-bottom:4px;">
            文件名 <span style="color:#888;font-weight:normal;">（可选）</span>
          </div>
          <input id="${CONFIG.FILENAME_INPUT_ID}" type="text"
                 style="padding:4px 10px;width:100%;box-sizing:border-box;${inputStyles}"
                 placeholder="留空将使用对话标题">
          <div style="font-size:0.84em;color:#888;margin-top:3px;">
            格式：Gemini_标题.md &nbsp;·&nbsp; 请勿含扩展名
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <span style="font-weight:bold;margin-right:8px;">选择消息：</span>
          <select id="${CONFIG.SELECT_DROPDOWN_ID}"
                  style="padding:3px 8px;${inputStyles}">
            <option value="all">全部</option>
            <option value="ai">仅 AI 回复</option>
            <option value="none">不选</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div style="margin-bottom:12px;padding:10px 0;border-top:1px solid ${isDark ? '#333' : '#eee'};border-bottom:1px solid ${isDark ? '#333' : '#eee'};">
          <button id="${CONFIG.BATCH_CONFIRM_BTN_ID}" style="width:100%;padding:7px 12px;background:transparent;color:${CONFIG.STYLES.BUTTON_PRIMARY};border:1px solid ${CONFIG.STYLES.BUTTON_PRIMARY};border-radius:5px;font-size:0.95em;font-weight:bold;cursor:pointer;">
            批量导出侧栏对话
          </button>
          <button id="${CONFIG.BATCH_SELECT_BTN_ID}" style="width:100%;margin-top:8px;padding:7px 12px;background:transparent;color:${CONFIG.STYLES.BUTTON_PRIMARY};border:1px solid ${CONFIG.STYLES.BUTTON_PRIMARY};border-radius:5px;font-size:0.95em;font-weight:bold;cursor:pointer;">
            选择对话导出
          </button>
          <div style="font-size:0.82em;color:#888;margin-top:6px;line-height:1.35;">
            将滚动左侧历史记录，并按对话分别保存到同一文件夹。
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:8px;border-top:1px solid ${isDark ? '#333' : '#eee'};">
          <button id="${CONFIG.CANCEL_BTN_ID}" style="${cancelStyle}">取消</button>
          <button id="${CONFIG.CONFIRM_BTN_ID}" style="${confirmStyle}">开始导出</button>
        </div>
      `;
    }

    static createButton() {
      const btn = document.createElement('button');
      btn.id = CONFIG.BUTTON_ID;
      btn.textContent = '导出对话';

      Object.assign(btn.style, {
        position: 'fixed',
        top: CONFIG.POSITION.BUTTON_TOP,
        right: CONFIG.POSITION.BUTTON_RIGHT,
        zIndex: '9999',
        padding: '8px 18px',
        background: CONFIG.STYLES.BUTTON_PRIMARY,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '0.95em',
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: 'background 0.2s'
      });

      btn.addEventListener('mouseenter', () => btn.style.background = CONFIG.STYLES.BUTTON_HOVER);
      btn.addEventListener('mouseleave', () => btn.style.background = CONFIG.STYLES.BUTTON_PRIMARY);

      return btn;
    }

    static createDropdown() {
      const isDark = DOMUtils.isDarkMode();
      const dropdown = document.createElement('div');
      dropdown.id = CONFIG.DROPDOWN_ID;

      Object.assign(dropdown.style, {
        position: 'fixed',
        top: CONFIG.POSITION.DROPDOWN_TOP,
        right: CONFIG.POSITION.DROPDOWN_RIGHT,
        zIndex: '9999',
        border: `1px solid ${isDark ? CONFIG.STYLES.DARK_BORDER : CONFIG.STYLES.LIGHT_BORDER}`,
        borderRadius: '8px',
        padding: '14px 16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        display: 'none',
        background: isDark ? '#222' : '#fff',
        color: isDark ? '#fff' : '#222',
        width: '320px'
      });

      dropdown.innerHTML = this.createDropdownHTML(isDark);
      return dropdown;
    }
  }

  // ============================================================================
  // EXPORT SERVICE
  // ============================================================================

  class ExportService {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
      this.markdownConverter = new MarkdownConverter();
    }

    _buildMarkdownHeader(conversationTitle) {
      const title = conversationTitle || 'Gemini 对话导出';
      const timestamp = DateUtils.getLocaleString();
      return `# ${title}\n\n> ${CONFIG.EXPORT_TIMESTAMP_LABEL}${timestamp}\n\n---\n\n`;
    }

    async buildMarkdown(turns, conversationTitle) {
      let markdown = this._buildMarkdownHeader(conversationTitle);

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        DOMUtils.showProgress(`正在处理第 ${i + 1} / ${turns.length} 轮对话…`);

        let turnContent = '';

        // User message
        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem) {
          const cb = userQueryElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`);
          if (cb?.checked) {
            const userQuery = this.markdownConverter.extractUserQuery(userQueryElem);
            if (userQuery) {
              turnContent += `## 👤 User\n\n${userQuery}\n\n`;
            }
          }
        }

        // Model response
        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem) {
          const cb = modelRespElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`);
          if (cb?.checked) {
            const modelResponse = this.markdownConverter.extractModelResponse(modelRespElem);
            if (modelResponse) {
              turnContent += `## 🤖 Gemini\n\n${modelResponse}\n\n`;
            } else {
              turnContent += `## 🤖 Gemini\n\n*[无法提取第 ${i + 1} 轮的模型回复]*\n\n`;
            }
          }
        }

        // Only add separator when there is actual exported content in this turn
        if (turnContent) {
          markdown += turnContent + '---\n\n';
        }
      }

      DOMUtils.hideProgress();
      return markdown;
    }

    async execute(exportMode, customFilename, selectionManager) {
      try {
        await ScrollService.loadAllMessages();

        const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
        this.checkboxManager.injectCheckboxes();

        // Reapply selection preset to any messages loaded during scroll
        if (selectionManager) {
          selectionManager.reapplyIfNeeded();
        }

        if (!this.checkboxManager.hasAnyChecked()) {
          alert('请至少勾选一条消息后再导出。');
          return;
        }

        const conversationTitle = FilenameService.getConversationTitle();
        const markdown = await this.buildMarkdown(turns, conversationTitle);

        if (exportMode === 'clipboard') {
          await FileExportService.exportToClipboard(markdown);
        } else {
          const filename = FilenameService.generate(customFilename, conversationTitle);
          FileExportService.downloadMarkdown(markdown, filename);
          DOMUtils.createNotification('✓ 文件已下载！');
        }

      } catch (error) {
        DOMUtils.hideProgress();
        console.error('Export error:', error);
        alert(`导出失败：${error.message}`);
      }
    }
  }

  // ============================================================================
  // BATCH EXPORT SERVICE
  // ============================================================================

  class BatchExportService {
    constructor(exportService, checkboxManager) {
      this.exportService = exportService;
      this.checkboxManager = checkboxManager;
      this.progressUI = null;
      this.paused = false;
      this.cancelRequested = false;
    }

    async execute(customFilename, selectionManager, options = {}) {
      const selectionValue = this._getBatchSelection(selectionManager);
      if (selectionValue === 'none') {
        alert('批量导出前请至少选择一种消息类型。');
        return;
      }

      this.paused = false;
      this.cancelRequested = false;
      this.progressUI = new BatchProgressUI({
        onPauseToggle: isPaused => this.setPaused(isPaused),
        onCancel: () => this.requestCancel()
      });
      DOMUtils.setProgressSink(message => this.progressUI?.setDetail(message));

      const originalPath = SidebarConversationService.getCurrentConversationPath();
      let conversations = [];
      let folderName = '';
      const exported = [];
      const failed = [];

      try {
        if (options.conversations?.length) {
          conversations = options.conversations;
          this.progressUI?.update({ phase: 'scan', found: conversations.length, detail: `已选择 ${conversations.length} 个对话。` });
        } else {
          conversations = await SidebarConversationService.loadAllConversationLinks({
            onProgress: ({ found, message }) => {
              this.progressUI?.update({ phase: 'scan', found, detail: message });
            },
            shouldStop: () => this.cancelRequested
          });
          await SidebarConversationService.scrollToTop();
        }

        if (!conversations.length) {
          throw new Error('没有可导出的对话。');
        }

        folderName = FilenameService.generateBatchFolder(customFilename);
        await FileExportService.downloadMarkdownToFolder(this._buildStartManifest(conversations, selectionValue), folderName, '_manifest_start.md');
        const usedFilenames = new Set();

        for (let i = 0; i < conversations.length; i++) {
          await this._waitIfPaused({ success: exported.length, failed: failed.length, total: conversations.length });
          this._throwIfCancelled();

          const entry = conversations[i];
          this.progressUI?.update({
            phase: 'export',
            current: i + 1,
            total: conversations.length,
            success: exported.length,
            failed: failed.length,
            title: entry.title,
            folderName,
            detail: '正在打开对话…'
          });

          try {
            await SidebarConversationService.openConversation(entry);
            this._throwIfCancelled();
            const markdown = await this._exportCurrentConversation(entry, selectionValue);
            this._throwIfCancelled();
            const filename = FilenameService.generateBatchConversationFile(entry, i + 1, conversations.length, usedFilenames);
            await this._downloadConversationMarkdown(markdown, folderName, filename, entry);
            exported.push({ ...entry, filename });
            this.progressUI?.update({
              phase: 'export',
              current: i + 1,
              total: conversations.length,
              success: exported.length,
              failed: failed.length,
              title: entry.title,
              folderName,
              detail: `已保存：${filename}`
            });
          } catch (error) {
            if (error?.name === 'BatchCancelledError') throw error;
            console.error('Batch export error:', entry, error);
            failed.push({ entry, message: error?.message || String(error) });
            this.progressUI?.update({
              phase: 'export',
              current: i + 1,
              total: conversations.length,
              success: exported.length,
              failed: failed.length,
              title: entry.title,
              folderName,
              detail: `失败：${error?.message || String(error)}`
            });
          } finally {
            this.checkboxManager.removeAll();
          }
        }

        if (failed.length) {
          await FileExportService.downloadMarkdownToFolder(this._buildFailureMarkdown(failed), folderName, '_failed.md');
        }

        if (!exported.length) {
          throw new Error('批量导出未成功导出任何对话。');
        }

        await FileExportService.downloadMarkdownToFolder(this._buildDoneManifest(exported, failed, conversations.length), folderName, '_manifest_done.md');
        const failureText = failed.length ? `，失败 ${failed.length} 个` : '';
        this.progressUI?.update({ phase: 'done', success: exported.length, failed: failed.length, total: conversations.length, folderName, detail: '下载已确认完成。' });
        DOMUtils.createNotification(`✓ 已导出 ${exported.length} 个对话到 ${folderName}/${failureText}`);

        await this._restoreOriginalConversation(originalPath, conversations);
      } catch (error) {
        if (error?.name === 'BatchCancelledError') {
          try {
            await FileExportService.downloadMarkdownToFolder(this._buildCancelledManifest(exported, failed, conversations.length), folderName || FilenameService.generateBatchFolder(customFilename), '_manifest_cancelled.md');
          } catch (cancelReportError) {
            console.warn('Could not write batch cancel report:', cancelReportError);
          }

          if (failed.length) {
            try {
              await FileExportService.downloadMarkdownToFolder(this._buildFailureMarkdown(failed), folderName || FilenameService.generateBatchFolder(customFilename), '_failed.md');
            } catch (failureReportError) {
              console.warn('Could not write batch failure report:', failureReportError);
            }
          }
          this.progressUI?.update({ phase: 'cancel', success: exported.length, failed: failed.length, total: conversations.length, folderName, detail: '已停止后续导出。已完成下载的文件会保留。' });
          return;
        }

        throw error;
      } finally {
        DOMUtils.clearProgressSink();
        DOMUtils.hideProgress();
        if (!this.cancelRequested) {
          this.progressUI?.dispose(CONFIG.TIMING.POPUP_DURATION);
        }
        this.progressUI = null;
      }
    }

    setPaused(isPaused) {
      this.paused = isPaused;
    }

    requestCancel() {
      this.cancelRequested = true;
      this.progressUI?.update({ phase: 'cancel', detail: '正在等待当前步骤结束后中止…' });
    }

    async _waitIfPaused({ success, failed, total }) {
      while (this.paused && !this.cancelRequested) {
        this.progressUI?.update({ phase: 'paused', success, failed, total, detail: '点击“继续”恢复导出，或点击“中止”停止后续导出。' });
        await DOMUtils.sleep(300);
      }
    }

    _throwIfCancelled() {
      if (!this.cancelRequested) return;
      const error = new Error('批量导出已中止。');
      error.name = 'BatchCancelledError';
      throw error;
    }

    _getBatchSelection(selectionManager) {
      const dropdown = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      const value = dropdown?.value || selectionManager?.lastSelection || 'all';
      return value === 'custom' ? 'all' : value;
    }

    async _exportCurrentConversation(entry, selectionValue) {
      await ScrollService.loadAllMessages();

      this.checkboxManager.injectCheckboxes();
      this._applySelection(selectionValue);

      const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
      if (!turns.length) {
        throw new Error('未找到当前对话内容。');
      }

      const conversationTitle = FilenameService.getConversationTitle() || entry.title;
      return this.exportService.buildMarkdown(turns, conversationTitle);
    }

    async _downloadConversationMarkdown(markdown, folderName, filename, entry) {
      const content = `<!-- Gemini conversation: ${entry.url} -->\n\n${markdown.trim()}\n`;
      await FileExportService.downloadMarkdownToFolder(content, folderName, filename);
    }

    _applySelection(selectionValue) {
      const checkboxes = document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`);

      switch (selectionValue) {
        case 'ai':
          document.querySelectorAll(`${CONFIG.SELECTORS.USER_QUERY} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = false);
          document.querySelectorAll(`${CONFIG.SELECTORS.MODEL_RESPONSE} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = true);
          break;
        case 'all':
        default:
          checkboxes.forEach(cb => cb.checked = true);
          break;
      }
    }

    _buildFailureMarkdown(failed) {
      const lines = failed.map(({ entry, message }) => {
        return `- ${entry.title} (${entry.url}): ${message}`;
      });

      return `# Gemini 批量导出失败列表\n\n` +
        `> ${CONFIG.EXPORT_TIMESTAMP_LABEL}${DateUtils.getLocaleString()}\n\n` +
        `${lines.join('\n')}\n`;
    }

    _buildStartManifest(conversations, selectionValue) {
      const lines = conversations.map((entry, index) => `${index + 1}. ${entry.title} (${entry.url})`);
      return `# Gemini 批量导出开始\n\n` +
        `> ${CONFIG.EXPORT_TIMESTAMP_LABEL}${DateUtils.getLocaleString()}\n` +
        `> 计划导出：${conversations.length} 个对话\n` +
        `> 消息选择：${selectionValue === 'ai' ? '仅 AI 回复' : '全部'}\n\n` +
        `${lines.join('\n')}\n`;
    }

    _buildDoneManifest(exported, failed, total) {
      const exportedLines = exported.map(item => `- ${item.filename}: ${item.title} (${item.url})`);
      const failedLines = failed.map(({ entry, message }) => `- ${entry.title} (${entry.url}): ${message}`);

      return `# Gemini 批量导出完成\n\n` +
        `> ${CONFIG.EXPORT_TIMESTAMP_LABEL}${DateUtils.getLocaleString()}\n` +
        `> 计划导出：${total}\n` +
        `> 成功：${exported.length}\n` +
        `> 失败：${failed.length}\n\n` +
        `## 成功文件\n\n${exportedLines.join('\n') || '- 无'}\n\n` +
        `## 失败项目\n\n${failedLines.join('\n') || '- 无'}\n`;
    }

    _buildCancelledManifest(exported, failed, total) {
      return `# Gemini 批量导出已中止\n\n` +
        `> ${CONFIG.EXPORT_TIMESTAMP_LABEL}${DateUtils.getLocaleString()}\n` +
        `> 计划导出：${total || '未知'}\n` +
        `> 已完成：${exported.length}\n` +
        `> 已失败：${failed.length}\n\n` +
        `已完成下载的文件会保留。没有 _manifest_done.md 表示该批次未完整完成。\n`;
    }

    async _restoreOriginalConversation(originalPath, conversations) {
      if (!originalPath || SidebarConversationService.getCurrentConversationPath() === originalPath) {
        return;
      }

      const originalEntry = conversations.find(entry => entry.path === originalPath);
      if (!originalEntry) return;

      try {
        DOMUtils.showProgress('正在回到开始导出前的对话…');
        await SidebarConversationService.openConversation(originalEntry);
      } catch (error) {
        console.warn('Could not restore original Gemini conversation:', error);
      } finally {
        DOMUtils.hideProgress();
      }
    }
  }

  // ============================================================================
  // EXPORT CONTROLLER
  // ============================================================================

  class ExportController {
    constructor() {
      this.checkboxManager = new CheckboxManager();
      this.selectionManager = new SelectionManager(this.checkboxManager);
      this.exportService = new ExportService(this.checkboxManager);
      this.batchExportService = new BatchExportService(this.exportService, this.checkboxManager);
      this.button = null;
      this.dropdown = null;
    }

    init() {
      this.createUI();
      this.attachEventListeners();
      this.observeStorageChanges();
    }

    createUI() {
      this.button = UIBuilder.createButton();
      this.dropdown = UIBuilder.createDropdown();

      document.body.appendChild(this.dropdown);
      document.body.appendChild(this.button);

      this._setupFilenameRowToggle();
    }

    _setupFilenameRowToggle() {
      const update = () => {
        const fileRow  = this.dropdown.querySelector('#gemini-filename-row');
        const fileRadio = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"][value="file"]`);
        if (fileRow && fileRadio) {
          fileRow.style.display = fileRadio.checked ? 'block' : 'none';
        }
      };

      this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`)
        .forEach(radio => radio.addEventListener('change', update));

      update();
    }

    attachEventListeners() {
      // Main button: toggle dropdown open/close
      this.button.addEventListener('click', () => this.toggleDropdown());

      // Selection dropdown changes
      this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`)
        .addEventListener('change', e => this._handleSelectionChange(e.target.value));

      // "开始导出" confirm button
      this.dropdown.querySelector(`#${CONFIG.CONFIRM_BTN_ID}`)
        .addEventListener('click', () => this.startExport());

      // Batch export button
      this.dropdown.querySelector(`#${CONFIG.BATCH_CONFIRM_BTN_ID}`)
        .addEventListener('click', () => this.startBatchExport());

      // Selective batch export button
      this.dropdown.querySelector(`#${CONFIG.BATCH_SELECT_BTN_ID}`)
        .addEventListener('click', () => this.startSelectedBatchExport());

      // "取消" cancel button
      this.dropdown.querySelector(`#${CONFIG.CANCEL_BTN_ID}`)
        .addEventListener('click', () => this.cancelExport());

      // Manual checkbox change → switch to custom mode
      document.addEventListener('change', e => {
        if (e.target?.classList?.contains(CONFIG.CHECKBOX_CLASS)) {
          const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
          if (select && select.value !== 'custom') {
            select.value = 'custom';
            this.selectionManager.lastSelection = 'custom';
          }
        }
      });

      // Click outside dropdown → cancel (close + remove checkboxes)
      document.addEventListener('mousedown', e => {
        if (this.dropdown.style.display !== 'none' &&
            !this.dropdown.contains(e.target) &&
            e.target !== this.button) {
          this.cancelExport();
        }
      });
    }

    toggleDropdown() {
      if (this.dropdown.style.display === 'none') {
        // Refresh theme colours each open
        const isDark = DOMUtils.isDarkMode();
        this.dropdown.style.background = isDark ? '#222' : '#fff';
        this.dropdown.style.color      = isDark ? '#fff' : '#222';
        this.dropdown.style.borderColor = isDark ? CONFIG.STYLES.DARK_BORDER : CONFIG.STYLES.LIGHT_BORDER;

        this.dropdown.style.display = '';

        // Inject checkboxes so the user can preview and adjust selection
        this.checkboxManager.injectCheckboxes();
        this.selectionManager.reapplyIfNeeded();
      } else {
        this.cancelExport();
      }
    }

    _handleSelectionChange(value) {
      this.checkboxManager.injectCheckboxes();
      this.selectionManager.applySelection(value);
    }

    cancelExport() {
      this.dropdown.style.display = 'none';
      this.checkboxManager.removeAll();
      // Do not reset selection – user may want to keep it for the next export
    }

    async startExport() {
      const exportMode = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"]:checked`)?.value || 'file';
      const customFilename = exportMode === 'file'
        ? (this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`)?.value.trim() || '')
        : '';

      this.dropdown.style.display = 'none';
      this.button.disabled = true;
      this.button.textContent = '导出中…';

      try {
        await this.exportService.execute(exportMode, customFilename, this.selectionManager);
      } finally {
        this.checkboxManager.removeAll();
        this.selectionManager.reset();

        const filenameInput = this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`);
        if (filenameInput) filenameInput.value = '';

        this.button.disabled = false;
        this.button.textContent = '导出对话';
      }
    }

    async startBatchExport() {
      const filenameInput = this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`);
      const customFilename = filenameInput?.value.trim() || '';

      this.dropdown.style.display = 'none';
      this.button.disabled = true;
      this.button.textContent = '批量导出中…';

      try {
        await this.batchExportService.execute(customFilename, this.selectionManager);
      } catch (error) {
        DOMUtils.hideProgress();
        console.error('Batch export error:', error);
        alert(`批量导出失败：${error.message}`);
      } finally {
        this.checkboxManager.removeAll();
        this.selectionManager.reset();

        if (filenameInput) filenameInput.value = '';

        this.button.disabled = false;
        this.button.textContent = '导出对话';
      }
    }

    async startSelectedBatchExport() {
      const filenameInput = this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`);
      const customFilename = filenameInput?.value.trim() || '';

      this.dropdown.style.display = 'none';
      this.button.disabled = true;
      this.button.textContent = '扫描中…';

      try {
        const conversations = await SidebarConversationService.loadAllConversationLinks({
          onProgress: ({ found, message }) => {
            DOMUtils.showProgress(`${message}｜稍后可手动选择`);
          }
        });
        await SidebarConversationService.scrollToTop();
        DOMUtils.hideProgress();

        const selected = await BatchSelectionDialog.open(conversations);
        if (!selected) return;

        this.button.textContent = '批量导出中…';
        await this.batchExportService.execute(customFilename, this.selectionManager, { conversations: selected });
      } catch (error) {
        DOMUtils.hideProgress();
        console.error('Selected batch export error:', error);
        alert(`选择导出失败：${error.message}`);
      } finally {
        this.checkboxManager.removeAll();
        this.selectionManager.reset();

        if (filenameInput) filenameInput.value = '';

        this.button.disabled = false;
        this.button.textContent = '导出对话';
      }
    }

    observeStorageChanges() {
      const updateVisibility = () => {
        try {
          if (chrome?.storage?.sync) {
            chrome.storage.sync.get(['hideExportBtn'], result => {
              this.button.style.display = result.hideExportBtn ? 'none' : '';
            });
          }
        } catch (e) {
          console.error('Storage access error:', e);
        }
      };

      updateVisibility();

      // Listen only to storage events – no MutationObserver on the full DOM
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && 'hideExportBtn' in changes) {
            updateVisibility();
          }
        });
      }
    }
  }

  // ============================================================================
  // INITIALIZATION + SPA NAVIGATION DETECTION
  // ============================================================================

  const controller = new ExportController();
  controller.init();

  // Gemini is a SPA: re-initialize if the button disappears after navigation
  setInterval(() => {
    if (!document.getElementById(CONFIG.BUTTON_ID) &&
        document.querySelector(CONFIG.SELECTORS.CHAT_CONTAINER)) {
      const freshController = new ExportController();
      freshController.init();
    }
  }, 2000);

})();
