
/**
 * ChatGPT Chat Exporter - Content script
 * Exports ChatGPT conversations to Markdown with message selection.
 * Version 4.1.0 - Localized UI, improved reliability
 */

(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const CONFIG = {
    BUTTON_ID: 'chatgpt-export-btn',
    DROPDOWN_ID: 'chatgpt-export-dropdown',
    FILENAME_INPUT_ID: 'chatgpt-filename-input',
    SELECT_DROPDOWN_ID: 'chatgpt-select-dropdown',
    CHECKBOX_CLASS: 'chatgpt-export-checkbox',
    EXPORT_MODE_NAME: 'chatgpt-export-mode',
    CONFIRM_BTN_ID: 'chatgpt-export-confirm',
    CANCEL_BTN_ID: 'chatgpt-export-cancel',

    SELECTORS: {
      CONVERSATION_TURN: 'article[data-testid^="conversation-turn-"]',
      USER_HEADING: 'h5.sr-only',
      MODEL_HEADING: 'h6.sr-only',
      COPY_BUTTON: 'button[data-testid="copy-turn-action-button"]',
      THREAD_TITLE: 'main h1'
    },

    CHAT_CONTAINER_CANDIDATES: [
      'div[data-testid="conversation-turns"]',
      'div[aria-label="Chat history"]',
      'div.flex.h-full.flex-col.overflow-y-auto',
      'div.flex.h-full.w-full.flex-col.overflow-y-auto',
      'main div.flex-1.overflow-y-auto',
      'main div.overflow-y-auto'
    ],

    TIMING: {
      SCROLL_DELAY: 2000,
      MAX_SCROLL_ATTEMPTS: 60,
      MAX_STABLE_SCROLLS: 4,
      CLIPBOARD_CLEAR_DELAY: 150,
      CLIPBOARD_READ_DELAY: 300,
      MAX_CLIPBOARD_ATTEMPTS: 10,
      FOCUS_WAIT_TIMEOUT: 15000,
      POPUP_DURATION: 2500
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

    FILENAME_PREFIX: 'ChatGPT'
  };

  // ============================================================================
  // UTILITIES
  // ============================================================================

  const Utils = {
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    isDarkMode() {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    },

    sanitizeFilename(text) {
      return text
        .replace(/[\\/:*?"<>|.]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    },

    getDateString() {
      const d = new Date();
      const pad = n => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    },

    // Single updatable progress notification
    _progressEl: null,

    showProgress(message) {
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
        pointerEvents: 'none'
      });
      el.textContent = message;
      document.body.appendChild(el);
      this._progressEl = el;
    },

    hideProgress() {
      if (this._progressEl) {
        this._progressEl.remove();
        this._progressEl = null;
      }
    },

    createNotification(message) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '99999',
        background: '#333',
        color: '#fff',
        padding: '9px 16px',
        borderRadius: '6px',
        fontSize: '0.95em',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        pointerEvents: 'none'
      });
      el.textContent = message;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), CONFIG.TIMING.POPUP_DURATION);
      return el;
    },

    // Simple HTML → Markdown for user messages
    htmlToMarkdown(el) {
      if (!el) return '';
      const walk = node => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        const children = () => Array.from(node.childNodes).map(walk).join('');

        switch (tag) {
          case 'br':     return '\n';
          case 'p':      return children() + '\n\n';
          case 'strong':
          case 'b':      return `**${children()}**`;
          case 'em':
          case 'i':      return `*${children()}*`;
          case 'code':   return `\`${node.textContent}\``;
          case 'pre':    return `\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
          case 'ul': {
            const items = Array.from(node.querySelectorAll(':scope > li'));
            return items.map(li => `- ${walk(li).trim()}`).join('\n') + '\n\n';
          }
          case 'ol': {
            const items = Array.from(node.querySelectorAll(':scope > li'));
            return items.map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n') + '\n\n';
          }
          default:       return children();
        }
      };
      return walk(el).trim();
    }
  };

  // ============================================================================
  // CHECKBOX MANAGER
  // ============================================================================

  class CheckboxManager {
    create(turn, type, topOffset) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = `${CONFIG.CHECKBOX_CLASS} ${type}`;
      checkbox.checked = true;
      checkbox.title = `将此${type === 'user' ? '用户' : 'ChatGPT'}消息包含在导出中`;

      Object.assign(checkbox.style, {
        position: 'absolute',
        right: '28px',
        top: topOffset,
        zIndex: '10000',
        transform: 'scale(1.2)'
      });

      if (turn.style.position !== 'relative') {
        turn.style.position = 'relative';
      }

      turn.appendChild(checkbox);
      return checkbox;
    }

    injectCheckboxes() {
      const turns = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN);

      turns.forEach(turn => {
        const userHeading = turn.querySelector(CONFIG.SELECTORS.USER_HEADING);
        if (userHeading && !turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.user`)) {
          this.create(turn, 'user', '8px');
        }

        const modelHeading = turn.querySelector(CONFIG.SELECTORS.MODEL_HEADING);
        if (modelHeading && !turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.model`)) {
          this.create(turn, 'model', '36px');
        }
      });
    }

    removeAll() {
      document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.remove());
    }

    anyChecked() {
      return Array.from(document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`)).some(cb => cb.checked);
    }
  }

  // ============================================================================
  // SELECTION MANAGER
  // ============================================================================

  class SelectionManager {
    constructor() {
      this.lastSelection = 'all';
    }

    apply(value) {
      switch (value) {
        case 'all':
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.checked = true);
          break;
        case 'ai':
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}.user`).forEach(cb => cb.checked = false);
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}.model`).forEach(cb => cb.checked = true);
          break;
        case 'none':
          document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.checked = false);
          break;
      }
      this.lastSelection = value;
    }

    reapplyIfNeeded() {
      const dropdown = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (dropdown && this.lastSelection !== 'custom') {
        dropdown.value = this.lastSelection;
        this.apply(this.lastSelection);
      }
    }

    reset() {
      const dropdown = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (dropdown) dropdown.value = 'all';
      this.lastSelection = 'all';
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

    static createButton() {
      const button = document.createElement('button');
      button.id = CONFIG.BUTTON_ID;
      button.textContent = '导出对话';

      Object.assign(button.style, {
        position: 'fixed',
        bottom: '100px',
        right: '20px',
        zIndex: '9999',
        padding: '8px 18px',
        background: CONFIG.STYLES.BUTTON_PRIMARY,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '0.95em',
        fontWeight: 'bold',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        transition: 'background 0.2s'
      });

      button.addEventListener('mouseenter', () => button.style.background = CONFIG.STYLES.BUTTON_HOVER);
      button.addEventListener('mouseleave', () => button.style.background = CONFIG.STYLES.BUTTON_PRIMARY);

      return button;
    }

    static createDropdown(isDark) {
      const dropdown = document.createElement('div');
      dropdown.id = CONFIG.DROPDOWN_ID;

      Object.assign(dropdown.style, {
        position: 'fixed',
        bottom: '148px',
        right: '20px',
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

      const inputStyles = this.getInputStyles(isDark);
      const confirmStyle = `padding:7px 20px;background:${CONFIG.STYLES.BUTTON_PRIMARY};color:#fff;border:none;border-radius:5px;font-size:0.95em;font-weight:bold;cursor:pointer;`;
      const cancelStyle  = `padding:7px 14px;background:transparent;color:${isDark ? '#aaa' : '#666'};border:1px solid ${isDark ? '#555' : '#ccc'};border-radius:5px;font-size:0.95em;cursor:pointer;`;

      dropdown.innerHTML = `
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
        <div id="chatgpt-filename-row" style="margin-bottom:10px;">
          <div style="font-weight:bold;margin-bottom:4px;">
            文件名 <span style="color:#888;font-weight:normal;">（可选）</span>
          </div>
          <input id="${CONFIG.FILENAME_INPUT_ID}" type="text" value=""
                 style="padding:4px 10px;width:100%;box-sizing:border-box;${inputStyles}"
                 placeholder="留空将使用对话标题">
          <div style="font-size:0.84em;color:#888;margin-top:3px;">
            格式：ChatGPT_文件名_日期.md &nbsp;·&nbsp; 请勿含扩展名
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <span style="font-weight:bold;margin-right:8px;">选择消息：</span>
          <select id="${CONFIG.SELECT_DROPDOWN_ID}" style="padding:3px 8px;${inputStyles}">
            <option value="all">全部</option>
            <option value="ai">仅 AI 回复</option>
            <option value="none">不选</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:8px;border-top:1px solid ${isDark ? '#333' : '#eee'};">
          <button id="${CONFIG.CANCEL_BTN_ID}" style="${cancelStyle}">取消</button>
          <button id="${CONFIG.CONFIRM_BTN_ID}" style="${confirmStyle}">开始导出</button>
        </div>
      `;

      return dropdown;
    }
  }

  // ============================================================================
  // EXPORT SERVICE
  // ============================================================================

  class ExportService {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
    }

    getChatContainer() {
      for (const selector of CONFIG.CHAT_CONTAINER_CANDIDATES) {
        const el = document.querySelector(selector);
        if (el) return el;
      }

      const firstTurn = document.querySelector(CONFIG.SELECTORS.CONVERSATION_TURN);
      if (firstTurn) {
        const ancestor = firstTurn.closest('div.overflow-y-auto, div.flex-1, main');
        if (ancestor) return ancestor;
        return firstTurn.parentElement;
      }

      return null;
    }

    async scrollToLoadAll() {
      const container = this.getChatContainer();
      if (!container) {
        throw new Error('未找到对话容器，请确认当前页面为 ChatGPT 对话页面。');
      }

      let stableScrolls = 0;
      let attempts = 0;
      let lastScrollTop = null;

      while (stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS && attempts < CONFIG.TIMING.MAX_SCROLL_ATTEMPTS) {
        const currentTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        Utils.showProgress(`正在加载历史消息… 第 ${attempts + 1} 次，已找到 ${currentTurnCount} 轮对话`);

        container.scrollTop = 0;
        await Utils.sleep(CONFIG.TIMING.SCROLL_DELAY);

        const newTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        const currentTop = container.scrollTop;

        if (newTurnCount === currentTurnCount && (lastScrollTop === currentTop || currentTop === 0)) {
          stableScrolls++;
        } else {
          stableScrolls = 0;
        }

        lastScrollTop = currentTop;
        attempts++;
      }

      Utils.hideProgress();
    }

    async _waitForFocus(timeout) {
      if (document.hasFocus()) return true;
      return new Promise(resolve => {
        const onFocus = () => {
          clearTimeout(timer);
          window.removeEventListener('focus', onFocus);
          resolve(true);
        };
        const timer = setTimeout(() => {
          window.removeEventListener('focus', onFocus);
          resolve(false);
        }, timeout);
        window.addEventListener('focus', onFocus);
      });
    }

    async copyModelResponse(copyButton) {
      // Clear clipboard before starting
      try { await navigator.clipboard.writeText(''); } catch (e) {}

      let attempts = 0;
      while (attempts < CONFIG.TIMING.MAX_CLIPBOARD_ATTEMPTS) {
        // Ensure page has focus before clipboard interaction
        if (!document.hasFocus()) {
          Utils.createNotification('⚠️ 请切回此页面以继续导出…');
          const focused = await this._waitForFocus(CONFIG.TIMING.FOCUS_WAIT_TIMEOUT);
          if (!focused) return '';
        }

        copyButton.click();
        await Utils.sleep(CONFIG.TIMING.CLIPBOARD_READ_DELAY);

        try {
          const text = await navigator.clipboard.readText();
          if (text) return text;
        } catch (e) {
          // Clipboard read failed (page may have lost focus)
        }

        // Clear before next retry so stale data is never returned
        try { await navigator.clipboard.writeText(''); } catch (e) {}
        attempts++;
        await Utils.sleep(CONFIG.TIMING.CLIPBOARD_CLEAR_DELAY);
      }

      return '';
    }

    getConversationTitle() {
      const heading = document.querySelector(CONFIG.SELECTORS.THREAD_TITLE);
      if (heading?.textContent?.trim()) return heading.textContent.trim();
      return document.title?.trim() || '';
    }

    generateFilename(custom, title) {
      const prefix    = CONFIG.FILENAME_PREFIX;
      const timestamp = Utils.getDateString();

      if (custom?.trim()) {
        let base = custom.trim().replace(/\.[^/.]+$/, '');
        base = base.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff\u3040-\u30ff]/g, '_');
        return base ? `${prefix}_${base}_${timestamp}` : `${prefix}_${timestamp}`;
      }

      if (title) {
        const safe = Utils.sanitizeFilename(title);
        if (safe) return `${prefix}_${safe}_${timestamp}`;
      }

      return `${prefix}_${timestamp}`;
    }

    async buildMarkdown(turns, title) {
      let markdown = title
        ? `# ${title}\n\n`
        : '# ChatGPT 对话导出\n\n';
      markdown += `> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        Utils.showProgress(`正在处理第 ${i + 1} / ${turns.length} 轮对话…`);

        let turnContent = '';

        // User message
        const userHeading  = turn.querySelector(CONFIG.SELECTORS.USER_HEADING);
        const userCheckbox = turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.user`);
        if (userHeading && userCheckbox?.checked) {
          const contentEl = userHeading.nextElementSibling;
          const userContent = contentEl ? Utils.htmlToMarkdown(contentEl) : '';
          turnContent += userContent
            ? `## 👤 User\n\n${userContent}\n\n`
            : `## 👤 User\n\n*[无法读取第 ${i + 1} 轮的用户消息]*\n\n`;
        }

        // Model response
        const modelHeading  = turn.querySelector(CONFIG.SELECTORS.MODEL_HEADING);
        const modelCheckbox = turn.querySelector(`.${CONFIG.CHECKBOX_CLASS}.model`);
        if (modelHeading && modelCheckbox?.checked) {
          const copyBtn = turn.querySelector(CONFIG.SELECTORS.COPY_BUTTON);
          if (copyBtn) {
            const clipboardText = await this.copyModelResponse(copyBtn);
            turnContent += clipboardText
              ? `## 🤖 ChatGPT\n\n${clipboardText}\n\n`
              : `## 🤖 ChatGPT\n\n*[无法获取第 ${i + 1} 轮的回复内容]*\n\n`;
          } else {
            turnContent += `## 🤖 ChatGPT\n\n*[第 ${i + 1} 轮复制按钮不可用]*\n\n`;
          }
        }

        // Only add separator when there is actual exported content in this turn
        if (turnContent) {
          markdown += turnContent + '---\n\n';
        }
      }

      Utils.hideProgress();
      return markdown;
    }

    async exportFile(markdown, filenameBase) {
      const blob   = new Blob([markdown], { type: 'text/markdown' });
      const url    = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href     = url;
      anchor.download = `${filenameBase}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }, 1000);
    }

    async execute(mode, customFilename, selectionManager) {
      await this.scrollToLoadAll();

      this.checkboxManager.injectCheckboxes();

      // Reapply selection preset to any messages loaded during scroll
      if (selectionManager) selectionManager.reapplyIfNeeded();

      if (!this.checkboxManager.anyChecked()) {
        alert('请至少勾选一条消息后再导出。');
        return;
      }

      const turns    = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
      const title    = this.getConversationTitle();
      const markdown = await this.buildMarkdown(turns, title);

      if (mode === 'clipboard') {
        await navigator.clipboard.writeText(markdown);
        Utils.createNotification('✓ 已复制到剪贴板！');
      } else {
        const filenameBase = this.generateFilename(customFilename, title);
        await this.exportFile(markdown, filenameBase);
        Utils.createNotification('✓ 文件已下载！');
      }
    }
  }

  // ============================================================================
  // CONTROLLER
  // ============================================================================

  class ExportController {
    constructor() {
      this.checkboxManager  = new CheckboxManager();
      this.selectionManager = new SelectionManager();
      this.exportService    = new ExportService(this.checkboxManager);
      this.button   = null;
      this.dropdown = null;
    }

    init() {
      const isDark   = Utils.isDarkMode();
      this.button   = UIBuilder.createButton();
      this.dropdown = UIBuilder.createDropdown(isDark);

      document.body.appendChild(this.button);
      document.body.appendChild(this.dropdown);

      this._setupFilenameRowToggle();
      this._bindEvents();
      this._observeVisibility();
    }

    _setupFilenameRowToggle() {
      const update = () => {
        const filenameRow = this.dropdown.querySelector('#chatgpt-filename-row');
        const fileRadio   = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"][value="file"]`);
        if (filenameRow && fileRadio) {
          filenameRow.style.display = fileRadio.checked ? 'block' : 'none';
        }
      };

      this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`)
        .forEach(radio => radio.addEventListener('change', update));

      update();
    }

    _bindEvents() {
      // Main button: toggle dropdown
      this.button.addEventListener('click', () => this.toggleDropdown());

      // Selection dropdown changes
      this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`)
        .addEventListener('change', event => {
          const value = event.target.value;
          this.checkboxManager.injectCheckboxes();
          this.selectionManager.apply(value);
        });

      // "开始导出" confirm button
      this.dropdown.querySelector(`#${CONFIG.CONFIRM_BTN_ID}`)
        .addEventListener('click', () => this.startExport());

      // "取消" cancel button
      this.dropdown.querySelector(`#${CONFIG.CANCEL_BTN_ID}`)
        .addEventListener('click', () => this.cancelExport());

      // Manual checkbox change → switch to custom mode
      document.addEventListener('change', event => {
        if (event.target?.classList?.contains(CONFIG.CHECKBOX_CLASS)) {
          const dropdown = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
          if (dropdown && dropdown.value !== 'custom') {
            dropdown.value = 'custom';
            this.selectionManager.lastSelection = 'custom';
          }
        }
      });

      // Click outside → cancel (close + remove checkboxes)
      document.addEventListener('mousedown', event => {
        if (this.dropdown.style.display !== 'none' &&
            !this.dropdown.contains(event.target) &&
            event.target !== this.button) {
          this.cancelExport();
        }
      });
    }

    toggleDropdown() {
      if (this.dropdown.style.display === 'none') {
        // Refresh theme colours each open
        const isDark = Utils.isDarkMode();
        this.dropdown.style.background  = isDark ? '#222' : '#fff';
        this.dropdown.style.color       = isDark ? '#fff' : '#222';
        this.dropdown.style.borderColor = isDark ? CONFIG.STYLES.DARK_BORDER : CONFIG.STYLES.LIGHT_BORDER;

        this.dropdown.style.display = '';

        // Inject checkboxes so user can preview and adjust selection
        this.checkboxManager.injectCheckboxes();
        this.selectionManager.reapplyIfNeeded();
      } else {
        this.cancelExport();
      }
    }

    cancelExport() {
      this.dropdown.style.display = 'none';
      this.checkboxManager.removeAll();
      // Preserve selection setting for next use
    }

    async startExport() {
      const mode = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"]:checked`)?.value || 'file';
      const filenameInput = this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`);
      const customFilename = mode === 'file' ? filenameInput?.value?.trim() || '' : '';

      this.dropdown.style.display = 'none';
      this.button.disabled    = true;
      this.button.textContent = '导出中…';

      try {
        await this.exportService.execute(mode, customFilename, this.selectionManager);
      } catch (error) {
        console.error('Export error:', error);
        alert(`导出失败：${error.message}`);
      } finally {
        this.checkboxManager.removeAll();
        this.selectionManager.reset();
        if (filenameInput) filenameInput.value = '';

        this.button.disabled    = false;
        this.button.textContent = '导出对话';
      }
    }

    _observeVisibility() {
      const update = () => {
        try {
          if (chrome?.storage?.sync) {
            chrome.storage.sync.get(['hideExportBtn'], result => {
              this.button.style.display = result.hideExportBtn ? 'none' : '';
            });
          }
        } catch (error) {
          console.error('Storage access error:', error);
        }
      };

      update();

      // Listen only to storage events – no MutationObserver on the full DOM
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && 'hideExportBtn' in changes) {
            update();
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

  // ChatGPT is a SPA: re-initialize if the button disappears after navigation
  setInterval(() => {
    if (!document.getElementById(CONFIG.BUTTON_ID) &&
        document.querySelector(CONFIG.SELECTORS.CONVERSATION_TURN)) {
      const freshController = new ExportController();
      freshController.init();
    }
  }, 2000);

})();
