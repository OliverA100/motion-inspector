// The extension's background script. It handles a click on the toolbar
// icon, and that is all.
//
// Why the click is handled here and not left to Chrome: Chrome can open the
// side panel by itself (openPanelOnActionClick), but then the extension is
// NOT given access to the tab, so "Pick element" could not reach any page.
// Found on the first real test. A click that the extension handles itself
// is what grants the activeTab permission for that tab. So: take the click
// here, which gives access to the tab in front, and open the panel from it.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error: unknown) => {
  console.error('Motion Inspector: could not set up the side panel.', error);
});

chrome.action.onClicked.addListener((tab) => {
  // This must be called at once, inside the click, or Chrome refuses it.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => {
    console.error('Motion Inspector: could not open the side panel.', error);
  });
  // Tell an open panel that this tab can now be inspected. If the panel is
  // only just opening, nobody is listening yet, which is fine.
  chrome.runtime.sendMessage({ from: 'motion-inspector-icon', tabId: tab.id }).catch(() => {});
});
