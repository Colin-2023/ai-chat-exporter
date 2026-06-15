/**
 * Extension background service worker.
 * Handles downloads that need a folder path via chrome.downloads.
 */

'use strict';

const MIME_MARKDOWN = 'text/markdown;charset=utf-8';
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function encodeMarkdownDataUrl(content) {
  return `data:${MIME_MARKDOWN},${encodeURIComponent(content)}`;
}

function downloadMarkdownFile({ folderName, filename, content }) {
  const normalizedFolder = String(folderName || 'Gemini_Exports').replace(/^\/+|\/+$/g, '');
  const normalizedFilename = String(filename || 'conversation.md').replace(/^\/+|\/+$/g, '');

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: encodeMarkdownDataUrl(content || ''),
      filename: `${normalizedFolder}/${normalizedFilename}`,
      conflictAction: 'uniquify',
      saveAs: false
    }, downloadId => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      waitForDownloadCompletion(downloadId)
        .then(() => resolve(downloadId))
        .catch(reject);
    });
  });
}

function waitForDownloadCompletion(downloadId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(onChanged);
      reject(new Error(`Download timed out: ${downloadId}`));
    }, DOWNLOAD_TIMEOUT_MS);

    const onChanged = delta => {
      if (delta.id !== downloadId || !delta.state?.current) return;

      if (delta.state.current === 'complete') {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve();
        return;
      }

      if (delta.state.current === 'interrupted') {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error(`Download interrupted: ${downloadId}`));
      }
    };

    chrome.downloads.onChanged.addListener(onChanged);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'downloadMarkdownFile') {
    return false;
  }

  downloadMarkdownFile(message.payload || {})
    .then(downloadId => sendResponse({ ok: true, downloadId }))
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});
