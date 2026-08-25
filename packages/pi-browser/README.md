# @zenspc/pi-browser

A Pi extension that lets the agent drive your running Chrome with your logged-in sessions.

The extension attaches over the Chrome DevTools Protocol to Chrome started with `--remote-debugging-port=9222` and never launches a browser itself. The agent works in a single owned Automation Tab; your other tabs are never touched.

Status: work in progress. Issue 01 ships the Attachment and `browser_navigate`.
