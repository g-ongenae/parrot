// Keyboard shortcuts (Alt+Shift+S / R / L) open Parrot without going through the popup.

browser.commands.onCommand.addListener(async (command, tab) => {
  const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  try {
    await launchParrot(target.id, command);
  } catch (err) {
    console.warn("Parrot cannot run on this page:", err);
  }
});
