/**
 * Gemini Chat Exporter - Gemini content script
 * Exports Gemini chat conversations to Markdown with LaTeX preservation
 * Version 4.1.0 - DOM-based extraction, localized UI
 */

(function() {
  'use strict';

  const CONFIG = {
    BUTTON_ID: 'gemini-export-btn',
    DROPDOWN_ID: 'gemini-export-dropdown',
    FILENAME_INPUT_ID: 'gemini-filename-input',
    SELECT_DROPDOWN_ID: 'gemini-select-dropdown',
    CHECKBOX_CLASS: 'gemini-export-checkbox',
    EXPORT_MODE_NAME: 'gemini-export-mode',
    CONFIRM_BTN_ID: 'gemini-export-confirm',
    CANCEL_BTN_ID: 'gemini-export-cancel',

    SELECTORS: {
      CHAT_CONTAINER: '[data-test-id="chat-history-container"]',
      CONVERSATION_TURN: 'div.conversation-container',
      USER_QUERY: 'user-query',
      USER_QUERY_TEXT: '.query-text .query-text-line',
      MODEL_RESPONSE: 'model-response',
      MODEL_RESPONSE_CONTENT: 'message-content .markdown',
      CONVERSATION_TITLE: '[data-test-id="conversation-title"]'
    },

    TIMING: {
      SCROLL_DELAY: 2000,
      POPUP_DURATION: 2500,
      NOTIFICATION_CLEANUP_DELAY: 1000,
      MAX_SCROLL_ATTEMPTS: 60,
      MAX_STABLE_SCROLLS: 4
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

    MATH_BLOCK_SELECTOR: '.math-block[data-math]',
    MATH_INLINE_SELECTOR: '.math-inline[data-math]',

    FILENAME_PREFIX: 'Gemini',
    EXPORT_TIMESTAMP_LABEL: '导出时间：'
  };

  // ============================================================================
  // UTILITY SERVICES
  // ============================================================================

  class DateUtils {
    static getDateString() {
      const d = new Date();
      const pad = n => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    static getLocaleString() {
      return new Date().toLocaleString();
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

    static showProgress(message) {
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
      const dateStr = DateUtils.getDateString();

      if (customFilename && customFilename.trim()) {
        const base = this._sanitizeCustomFilename(customFilename);
        return base ? `${prefix}_${base}_${dateStr}` : `${prefix}_${dateStr}`;
      }

      if (conversationTitle) {
        const safeTitle = StringUtils.sanitizeFilename(conversationTitle);
        if (safeTitle) return `${prefix}_${safeTitle}_${dateStr}`;
      }

      const pageTitle = document.querySelector('title')?.textContent.trim();
      if (pageTitle) {
        const safeTitle = StringUtils.sanitizeFilename(pageTitle);
        if (safeTitle) return `${prefix}_${safeTitle}_${dateStr}`;
      }

      return `${prefix}_${dateStr}`;
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
            格式：Gemini_文件名_日期.md &nbsp;·&nbsp; 请勿含扩展名
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
        bottom: '100px',
        right: '20px',
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
  // EXPORT CONTROLLER
  // ============================================================================

  class ExportController {
    constructor() {
      this.checkboxManager = new CheckboxManager();
      this.selectionManager = new SelectionManager(this.checkboxManager);
      this.exportService = new ExportService(this.checkboxManager);
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
