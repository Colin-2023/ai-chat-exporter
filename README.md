# AI Chat Exporter

Export your Gemini and ChatGPT conversations to perfectly formatted Markdown files with complete preservation of LaTeX math, code blocks, tables, and all formatting. Version 4.4.0 separates fast single-chat export from a unified Gemini choose/batch export flow.

## Features

- **DOM-based extraction for Gemini (v4.0.0+)**: Direct HTML parsing without clipboard dependency using Turndown library
- Export your full Gemini or ChatGPT chat conversation to Markdown, preserving formatting (code, tables, LaTeX, etc.)
- **Single-chat export**: Export the currently open Gemini or ChatGPT conversation without scanning the history sidebar
- **Unified Gemini choose/batch export (v4.4.0+)**: Scan the Gemini sidebar once, review a searchable picker that defaults to all conversations, then export all or only selected conversations
- Dedicated **导出对话 (Export Chat)** button appears automatically on every Gemini and ChatGPT chat page (upper-right area)
- Option to hide the export button via the extension popup
- **Granular message selection**: Use checkboxes next to each message to select exactly what to export
- **Selection presets**: Instantly select all, none, or only AI responses with a dropdown
- **Export to clipboard or file**: Copy your chat as Markdown directly to your clipboard—no file download needed, or save as .md file
- **Custom filename (optional)**: Enter a filename, or leave blank to use the chat title
- **Automatic lazy-loading**: Scrolls to load all messages in long conversations before export
- **Citation removal**: Automatically strips Gemini citation markers from exported content
- **Math formula support**: Preserves LaTeX equations from Gemini's `data-math` attributes
- Dark mode support: Export controls display correctly in both light and dark themes
- No build step required
- Open source under the Apache License 2.0

## Installation

1. **Download the latest release**
   - Go to the [Releases](https://github.com/amazingpaddy/gemini-chat-exporter/releases) page
   - Download the `gemini-chat-exporter.zip` file from the latest release
   - Unzip the file to a folder on your computer

2. **Load the extension in Chrome**
   - Open `chrome://extensions` in your Chrome browser
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked" and select the folder where you unzipped the extension files

3. **You're done!**
   - The **导出对话 (Export Chat)** button will now appear on every Gemini and ChatGPT chat page

## What's New in v4.4.0

- **Cleaner export choices**: The Gemini menu now has two clear actions: **导出当前对话** for the open chat, and **选择对话 / 批量导出** for sidebar history export.
- **No duplicate sidebar scans**: Removed the separate full-batch button. The choose/batch picker defaults to all conversations, so exporting everything and exporting a subset share one scan and one flow.
- **Better picker defaults**: Conversations are selected by default after scanning; clear all, search, Shift-select, or use ranges only when you want a subset.

## What's New in v4.3.2

- **Canvas navigation recovery**: Detects when a Gemini Canvas conversation collapses the history sidebar and automatically opens it again before navigating to the next conversation.
- **Localized sidebar controls**: Recognizes the current Chinese and English labels used by Gemini's sidebar toggle.
- **Batch and picker resilience**: Applies the same sidebar recovery before scanning history and while locating each selected conversation.
- **Scope**: This fixes batch navigation around Canvas conversations; extracting the separate Canvas editor content is still not supported.

## What's New in v4.3.1

- **Gemini May 20 UI compatibility**: Supports the sidebar structure where `data-test-id="conversation"` moved from the conversation link to its outer `gem-nav-list-item`.
- **Backward-compatible history discovery**: Continues to support the May 1 link-based structure while resolving the nested `/app/<id>` link used by the new UI.
- **Updated title extraction**: Reads both the old `.conversation-title` and new `.title-text` labels, with the link's `aria-label` as a fallback.

## What's New in v4.3.0

- **Selective batch export**: Added a searchable picker for choosing specific Gemini conversations before exporting.
- **Searchable selection picker**: Filter by title or conversation ID, then select visible rows with checkboxes.
- **Range selection**: Supports Shift-click continuous selection and explicit ranges such as `1-5,8,12-20`.
- **Conflict-free selection model**: Range input only changes the checkbox state when applying `替换为范围` or `追加范围`; the final export always uses the currently checked rows.

## What's New in v4.2.2

- **Batch progress panel**: Shows scan/export phase, current conversation, success/failure counts, destination folder, and current detail work.
- **Pause and cancel controls**: Batch export can pause between conversations or stop after the current step finishes.
- **More reliable sidebar scanning**: Uses scrollable-element detection plus `scrollBy`, `wheel`, and `scroll` events to better trigger Gemini sidebar lazy-loading.
- **Download completion tracking**: Background downloads now wait for Chrome to report `complete` or `interrupted` before the next file starts.
- **Batch manifest files**: Writes `_manifest_start.md`, `_manifest_done.md`, or `_manifest_cancelled.md` so interrupted folders are identifiable.

## What's New in v4.2.1

- **Foldered Gemini batch export**: Batch export now saves one `.md` file per conversation under a single folder such as `Gemini_All_Chats_YYYY-MM-DD_HHMMSS/`.
- **Downloads API integration**: Added a background service worker and `downloads` permission so batch files can be written with folder paths instead of triggering one large combined file.
- **Failure report file**: If some conversations fail, the extension writes `_failed.md` into the same folder with the affected titles, URLs, and errors.

## What's New in v4.2.0

- **Gemini batch export**: Added sidebar history export for all conversations discovered from the Gemini left sidebar.
- **Sidebar conversation discovery**: Detects Gemini history entries via `a[data-test-id="conversation"][href^="/app/"]`, normalizes `/app/<id>` links, and removes tracking query parameters for de-duplication.
- **Batch navigation workflow**: Opens each discovered conversation, waits for chat content to load, reuses the existing DOM-based Markdown extraction, and records failures.

## What's New in v4.1.0

- **Localized UI updates**: Main export controls now use localized Chinese labels by default (e.g., `导出对话`, `导出设置`)
- **Refined button placement**: Export button and panel are positioned in the upper-right area for faster access
- **Reliability improvements**: Better state handling for selection presets and long conversations

Support for other LLMs like DeepSeek, Claude, and Grok will be added in future updates.

## What's New in v4.0.0

### 🎉 DOM-Based Extraction for Gemini
- **No more clipboard dependency**: Gemini exports now use direct DOM parsing with the Turndown library
- **More reliable**: Eliminates clipboard race conditions and retry logic
- **Better formatting**: Direct HTML-to-Markdown conversion preserves complex formatting
- **Math formula support**: Extracts LaTeX equations from Gemini's `data-math` attributes
- **Enhanced privacy**: Clipboard access no longer required for Gemini

### Technical Improvements
- Integrated [Turndown.js](https://github.com/mixmark-io/turndown) for robust HTML→Markdown conversion
- Custom Turndown rules for math blocks, inline math, and tables
- Improved citation removal algorithm
- Fallback to manual DOM traversal if Turndown unavailable

### Migration Notes
- Old clipboard-based implementation preserved as `gemini_old.js`
- ChatGPT export unchanged (still uses clipboard method)
- All UI features maintained (checkboxes, selection presets, custom filenames)

## Usage

### Gemini
1. Go to [Gemini](https://gemini.google.com/) and open any chat conversation.
2. Click the **导出对话 (Export Chat)** button at the top right of the page.
3. In the export menu, use the **Select messages** dropdown to quickly select "All", "Only answers" (AI responses), or "None". You can also manually check/uncheck any message using the checkboxes on the right of each message. If you make a custom selection, the dropdown will show "Custom".
4. Choose your export mode:
   - **Export as file** (default): Downloads a Markdown (.md) file
   - **Export to clipboard**: Copies the conversation to your clipboard for pasting elsewhere
5. **(Optional)** Enter a custom filename, or leave blank to automatically use the conversation title.
6. Click **导出当前对话** to start. The button will show `导出中…` during the process.
7. The extension will:
   - Automatically scroll to load all messages in the conversation (including lazy-loaded older messages)
   - Extract content directly from the DOM (no clipboard needed!)
   - Convert formatting, tables, code blocks, and math formulas to Markdown
   - Remove Gemini citation markers like `[cite_start]` and `[cite:1,2,3]`
8. Your exported file will be named: `Gemini_<conversation_title>.md` (e.g., `Gemini_My_Conversation.md`)

**Gemini choose/batch export:**
1. Open Gemini with the left sidebar visible.
2. Click **导出对话 (Export Chat)**.
3. Choose the message preset. `全部` exports prompts and answers; `仅 AI 回复` exports only Gemini responses. `自定义` is treated as `全部` for batch mode.
4. Optional: enter a folder name. If blank, the folder is named like `Gemini_All_Chats_YYYY-MM-DD_HHMMSS`.
5. Click **选择对话 / 批量导出**. The extension scans the sidebar once and opens a picker with all discovered conversations selected by default.
6. To export everything, click **导出选中** immediately. To export a subset, click **清空全部**, then search titles, tick rows, Shift-click to select a continuous block, or type a range like `1-5,8,12-20`.
7. Range input does not automatically override manual checks. Use **替换为范围** to replace the current checked rows, or **追加范围** to add the range to the current checked rows.

**Batch export notes:**
- Batch export uses Chrome's downloads API and requires the `downloads` permission.
- Files are named with an ordinal prefix, for example `01_My_Conversation.md`.
- Failed conversations are listed in `_failed.md` in the same folder.
- `_manifest_start.md` is written first to create and identify the batch folder. `_manifest_done.md` means the batch completed; `_manifest_cancelled.md` means it was stopped before completion.
- Use the progress panel's **暂停 / 继续** and **中止** controls while a batch is running. Pause takes effect between conversations; cancel stops after the current step finishes.
- It depends on Gemini's visible sidebar history. The exporter supports the May 1 and May 20, 2026 sidebar DOM variants; if older conversations are not loaded by sidebar scrolling, they will not be included.
- The current page may move through multiple conversations during the export; the extension attempts to return to the starting conversation afterward.

**Supported formatting:**
- ✅ Text formatting (bold, italics, inline code)
- ✅ Headings (H1-H6)
- ✅ Code blocks with syntax highlighting markers
- ✅ Tables (converted to Markdown tables)
- ✅ Lists (ordered and unordered)
- ✅ Blockquotes
- ✅ Horizontal rules
- ✅ Math formulas (LaTeX from `data-math` attributes)
- ✅ Line breaks

**Not supported:**
- ❌ Canvas/drawing responses
- ❌ Embedded images
- ❌ File attachments

**Note:** All content is extracted directly from the DOM using the Turndown library, ensuring accurate formatting preservation without clipboard dependencies.

### ChatGPT
1. Go to [ChatGPT](https://chatgpt.com/) and open any chat conversation.
2. Click the **导出对话 (Export Chat)** button at the top right of the page.
3. Use the checkboxes and selection dropdown to choose which messages to export, just like in Gemini.
4. **(Optional)** Enter a custom filename, or leave blank to use the chat title.
5. Choose your export mode:
   - **Export as file** (default): Downloads a Markdown (.md) file
   - **Export to clipboard**: Copies the conversation to your clipboard
6. Click **导出当前对话** to start. The button will show `导出中…` during the process.
7. The extension will:
   - Automatically scroll to load all messages in the conversation
   - Use ChatGPT's built-in copy button to extract formatted content
   - Compile all selected messages into Markdown format
8. Your exported file will be named: `ChatGPT_<chat_title>.md` (e.g., `ChatGPT_My_Chat_Title.md`)

**Note:** ChatGPT export uses clipboard-based extraction via the platform's native copy button to ensure perfect formatting preservation.

## Permissions

This extension requires **storage** permission for extension settings, **clipboardRead** permission for ChatGPT exports, and **downloads** permission for Gemini batch exports into a shared folder.

**Important change in v4.0.0:** Gemini exports no longer require clipboard access! The extension now uses direct DOM-based extraction with the Turndown library to convert Gemini's HTML responses to Markdown. This provides:
- ✅ More reliable extraction (no clipboard race conditions)
- ✅ Better formatting preservation (direct HTML→Markdown conversion)
- ✅ Enhanced privacy (no clipboard access needed for Gemini)

ChatGPT still requires clipboard access as it uses the built-in copy button for reliable content extraction.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

## Attribution

Extension icons are generated using Gemini AI.
