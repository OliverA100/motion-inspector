// The extension's background script. It has one job: clicking the toolbar
// icon opens the side panel. Everything else happens in the panel.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
  console.error('Motion Inspector: could not set up the side panel.', error);
});
