// Loaded after popup.js. Keep reconnect fallback aware of every content helper.
messageTab = async function(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js', 'inventory.js', 'thread-inventory.js'] });
    await sleep(500);
    return chrome.tabs.sendMessage(tabId, message);
  }
};
