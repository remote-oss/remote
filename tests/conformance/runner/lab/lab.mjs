#!/usr/bin/env node
// lab: compact black-box observation of the lab VS Code window over CDP.
// Every subcommand prints a plain-text description of what is on screen.
//
//   lab state                      what is on screen now (title, quick input, dialogs, notifications, status bar)
//   lab windows                    list VS Code windows, numbered (choose one with LAB_WINDOW=#<n> or LAB_WINDOW=<title substring>)
//   lab cmd "<Category: Title>"    run a command from the Command Palette (exact title match), then print state
//   lab palette "<text>"           open the Command Palette, type text, print the visible items (does not run anything)
//   lab pick "<label>"             select the quick input item whose label matches (exact, else prefix), then print state
//   lab check "<label>"            toggle the checkbox of a multi-select quick input item
//   lab type "<text>"              replace the text in the quick input box or dialog input box, then print state
//   lab typeraw "<text>"           type into whatever has focus (editor, terminal) — only when you mean it
//   lab paths                      where this slot keeps its VS Code profile, state databases and logs
//   lab urls                       links VS Code opened "in the browser" (captured by the lab; nothing is really opened)
//   lab key <Key>                  press a key (Enter, Escape, ArrowDown, Mod+Shift+P, ...), then print state; Mod = Cmd on macOS, Ctrl elsewhere
//   lab button "<label>"           click a button in a dialog, notification, the quick input, or a view's title bar (icon-only buttons by accessible name), then print state
//   lab hover "<view>" "<row>"     rest the mouse on a view row and print the hover it opens ("<row>#2" = 2nd row with that label)
//   lab link "<text>"              click a link inside a notification, dialog, hover, or welcome view
//   lab remote                     click the remote indicator (bottom left) and print the menu
//   lab view "<view title>"        dump the rows of a visible tree view (e.g. "Dev Containers", "Dev Volumes")
//   lab rowmenu "<view>" "<row>"   right-click a tree row and print the context menu
//   lab rowaction "<view>" "<row>" "<action>"  click an inline action button on a tree row
//   lab viewaction "<view>" "<action>"  click an action in a view's title bar (Refresh, Collapse All, ...) by its accessible name
//   lab menu "<item>"              click an item of the open context menu
//   lab focus "<view or part>"     run "View: Focus on <x> View" style commands via palette text (e.g. "Remote Explorer")
//   lab notifications              list all notifications in the notification center (opens and closes it)
//   lab notifications-seen         every notification text shown since the window opened, even briefly (texts only)
//   lab notification-log-keep      stay attached and keep that log in every page from its first moment (the provisioner's)
//   lab editor                     print the active editor tab title and the first 60 lines of its text
//   lab terminal                   print the visible text of the active terminal
//   lab shot <name>                save a screenshot to $LAB_SHOTS_DIR/<name>.png
//   lab log [lines]                print the tail of the newest Dev Containers extension log file (default 80)
//   lab logs                       list the Dev Containers extension log files of the lab profile
//                                  (other rooms: the room's extension log folders and the output channels of [lab]
//                                  log_channels; --channel "<name>" picks one output channel, e.g. "Remote - SSH")
//   lab logs-all                   list every log of this slot (extension vs VS Code core), newest first
//   lab wait <seconds>             wait, then print state
//   lab items [max]                list ALL items of the open quick pick in order (walks the virtualized list)
//   lab watch <seconds>            poll the screen every 1.5 s and print each change (for progress notifications, reloads)
//   editor language features: <line>:<col> counts as Go to Line/Column and the status bar do (1-based; a tab counts to the
//   next tab stop); markers and the tokens of a line report character columns; --file <path> opens that file first (relative
//   to the workspace folder, through Quick Open); one JSON argument works too: lab suggest '{"file":"a.ts","line":3,"col":5}'
//   lab open <file>                open a workspace file through Quick Open, then print the cursor position
//   lab goto <line>[:<col>]        move the cursor (Go to Line/Column), then print where it landed
//   lab suggest [<line>:<col>] [--type <text>]  open the suggest list there (after typing <text>, undone afterwards) and print
//                                  EVERY item: order, label, kind icon, details, documentation, the preselected one; closes it
//   lab hovertext <line>:<col>     show the editor hover at a position and print all of it: text parts, links, hover actions
//   lab markers                    every Problems entry: file, severity, message, source, code, start; and where each squiggle
//                                  of the active file ends
//   lab tokens <line>[:<col>]      TextMate token and scopes at a position, or every token of the line ("Developer: Inspect
//                                  Editor Tokens and Scopes")
//   lab folds                      every folding range of the active editor: start, end, collapsed (folds are left as found)
//   lab outline                    the Outline view's symbols as a tree: name, detail, kind icon
//   lab breadcrumbs [<line>:<col>] the breadcrumb bar at the cursor: folders, file, symbols with their kind icons
//   lab panel                      the panel: shown or hidden, position, its tabs and the one in front, the terminal tabs (active,
//                                  focused), the Output channel shown, and how many lines of text it shows (not the text)
//   lab settings-editor [{"tabs":"all"}]  the open Settings editor: the tab in front, the tabs shown, and each setting row the
//                                  search shows: id, title, control, value, modified, indicators, description, validation;
//                                  with tabs all, also the row ids each tab lists (it clicks each tab, then the first again)
//   lab setting-input {"id":..,"value":..}  types a value into the text or number box of the shown row with that setting id
//   lab settings-search <text>     replaces the open Settings editor's search with <text> and waits for its rows to settle

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const HOME = process.env.HOME;
const { chromium } = require(process.env.LAB_PLAYWRIGHT || "playwright-core");
const OBS = process.env.LAB_SHOTS_DIR || "shots";
const SLOT = parseInt(process.env.LAB_SLOT || "0", 10);
const LAB = (process.env.LAB_SLOTS_DIR || HOME + "/conformance-work/slots") + "/" + SLOT;
const IDENTITY = new URL("../encode/identity.yaml", import.meta.url);
/* the extension ids of the identity file: `lab logs-all` marks their log folders as the extension's */
let EXT_IDS = [];
try { EXT_IDS = [...fs.readFileSync(IDENTITY, "utf8").matchAll(/^\s*extension_id:\s*([^\s#]+)/gm)].map((m) => m[1]).filter((x) => x !== "null"); } catch (e) { EXT_IDS = []; }
const PORT = 9222 + SLOT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

/* LAB_JSON=1 (2026-10-01, D-22 encode; block comments so `lab help` stays as it was):
   state, windows, view, items, notifications, editor print ONE JSON object instead of text; the action verbs (cmd,
   palette, pick, check, type, typeraw, key, button, link, remote, rowmenu, rowaction, menu, focus, hover, wait) print
   {command, args, ok, error?, messages?, picked?, hovers?, state?}; a failure prints {ok:false, error} and exits 1.
   Used by the encode recorder (record.py); the text output is unchanged without LAB_JSON. say() is console.log in text mode;
   fail() also marks the JSON result as failed. */
const JSON_MODE = !!process.env.LAB_JSON && process.env.LAB_JSON !== "0";
let RESULT = null;
function say(line) { if (JSON_MODE) (RESULT.messages = RESULT.messages || []).push(String(line)); else console.log(line); }
function fail(line) { if (JSON_MODE) { RESULT.ok = false; if (!RESULT.error) RESULT.error = String(line).split("\n")[0]; } say(line); }

// "<label>#<n>" picks the n-th (1-based) row whose text matches <label>, for identically-labelled rows (2026-09-29, F-0901)
function rowLocator(pane, row) {
  const m = /^(.*)#(\d+)$/.exec(row || "");
  return m ? pane.locator(".monaco-list-row").filter({ hasText: m[1] }).nth(Number(m[2]) - 1)
           : pane.locator(".monaco-list-row").filter({ hasText: row }).first();
}

/* Role locators (2026-10-02, encode addendum 9): an element whose accessible name is <want>, or <want> followed by a
   keybinding in parentheses ("Back (Alt+LeftArrow)"). Their click waits until the target is visible, stable, enabled
   and not covered, up to the timeout. */
function nameRe(want) { return new RegExp("^" + String(want).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\(.*\\))?$"); }

/* A view's title-bar action (icon-only buttons such as Refresh). VS Code shows them only while the view header is
   hovered or focused, so: find the button among hidden nodes too, hover its header, then click. A container that shows
   a single view puts that view's actions in the container's own title bar. view: the view title, or null for any. */
async function clickViewAction(page, view, action) {
  const panes = view ? page.locator(".pane").filter({ has: page.locator(".pane-header h3", { hasText: view }) }) : page.locator(".pane");
  const titles = view ? page.locator(".part > .composite.title").filter({ hasText: new RegExp(String(view).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
                      : page.locator(".part > .composite.title");
  for (const scope of [panes.locator(".pane-header"), titles]) {
    const n = await scope.count();
    for (let k = 0; k < n; k++) {
      const h = scope.nth(k);
      if (!(await h.isVisible().catch(() => false))) continue;
      const b = h.getByRole("button", { name: nameRe(action), includeHidden: true }).first();
      if (!(await b.count())) continue;
      await h.hover();
      try { await b.click({ timeout: 5000 }); return true; } catch (e) { /* not clickable: try the next header */ }
    }
  }
  return false;
}

async function connect() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + PORT, { timeout: 15000 });
  const all = browser.contexts().flatMap((c) => c.pages());
  const pages = all.filter((p) => p.url().includes("workbench"));
  if (!pages.length) throw new Error("no VS Code window found; start it with: lab-code start <folder> (slot " + SLOT + ")");
  let page = pages[pages.length - 1];
  const want = process.env.LAB_WINDOW;
  if (want) {
    // auxiliary windows (Issue Reporter, Process Explorer, ...) are separate pages without "workbench" in their URL:
    // LAB_WINDOW=<title substring> can select them too (2026-09-27, F-0105)
    // LAB_WINDOW=#<n> picks the n-th window of `lab windows` (for several windows with the same title, 2026-09-29, F-0604)
    if (/^#\d+$/.test(want)) {
      const i = Number(want.slice(1));
      if (!all[i]) throw new Error("LAB_WINDOW=" + want + ": no such window; see `lab windows`");
      page = all[i];
    } else for (const p of all) if ((await p.title()).includes(want)) page = p;
  }
  return { browser, page, pages, all };
}

async function snapshotState(page) {
  if (!page.url().includes("workbench")) {
    // an auxiliary window: its title, visible text and form fields
    return await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = ["WINDOW TITLE: " + document.title + "   (auxiliary window)"];
      for (const el of document.querySelectorAll("input, textarea, select")) {
        const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || el.name || el.tagName.toLowerCase();
        const val = el.tagName === "SELECT" ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : "") : (el.type === "checkbox" ? String(el.checked) : el.value);
        out.push("FIELD " + norm(label) + " = " + norm(val).slice(0, 300));
      }
      out.push("TEXT:");
      out.push((document.body ? document.body.innerText : "").split("\n").map(norm).filter(Boolean).join("\n").slice(0, 6000));
      return out.join("\n");
    });
  }
  return await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const out = [];
    out.push("WINDOW TITLE: " + document.title);
    // Quick input
    const qi = document.querySelector(".quick-input-widget");
    if (vis(qi)) {
      out.push("QUICK INPUT:");
      const title = qi.querySelector(".quick-input-title");
      if (title && norm(title.textContent)) out.push("  title: " + norm(title.textContent));
      const input = qi.querySelector(".quick-input-box input");
      if (input) {
        out.push("  placeholder: " + (input.getAttribute("placeholder") || ""));
        out.push("  value: " + input.value);
      }
      const msg = qi.querySelector(".quick-input-message");
      if (msg && norm(msg.textContent)) out.push("  message: " + norm(msg.textContent));
      const count = qi.querySelector(".quick-input-count");
      if (vis(count) && norm(count.textContent)) out.push("  count: " + norm(count.textContent));
      const tbtns = [...qi.querySelectorAll(".quick-input-titlebar .action-label, .quick-input-inline-action-bar .action-label")].filter(vis).map((b) => b.getAttribute("aria-label") || b.title).filter(Boolean);
      if (tbtns.length) out.push("  title buttons: " + tbtns.join(" | "));
      const ok = [...qi.querySelectorAll(".quick-input-action .monaco-button, .quick-input-ok .monaco-button")].filter(vis).map((b) => norm(b.textContent));
      if (ok.length) out.push("  buttons: " + ok.join(" | "));
      const multi = qi.querySelector(".quick-input-check-all");
      if (vis(multi)) out.push("  multi-select: yes (select-all checkbox " + (multi.checked ? "checked" : "unchecked") + ")");
      const rows = [...qi.querySelectorAll(".quick-input-list .monaco-list-row")].filter(vis);
      rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      out.push("  items (" + rows.length + " visible):");
      for (const r of rows) {
        let sep = r.querySelector(".quick-input-list-separator");
        if (sep && (sep.offsetParent === null || getComputedStyle(sep).display === "none")) sep = null;
        const label = r.querySelector(".quick-input-list-rows .monaco-icon-label .label-name, .quick-input-list-label .label-name, .monaco-icon-name-container");
        const desc = r.querySelector(".label-description");
        const detail = r.querySelector(".quick-input-list-detail, .quick-input-list-row-detail");
        const cb = r.querySelector("input[type=checkbox], .quick-input-list-checkbox");
        const icons = [...r.querySelectorAll(".quick-input-list-rows .codicon, .monaco-icon-label-container .codicon")].filter((i) => !i.closest(".quick-input-list-entry-action-bar")).map((i) => [...i.classList].find((c) => c.startsWith("codicon-") && c !== "codicon-modifier-spin")).filter(Boolean);
        const btns = [...r.querySelectorAll(".quick-input-list-entry-action-bar .action-label")].map((b) => b.getAttribute("aria-label") || b.title).filter(Boolean);
        let line = "   - ";
        if (r.classList.contains("focused")) line += "[focused] ";
        if (cb) line += (cb.checked || cb.getAttribute("aria-checked") === "true" || r.getAttribute("aria-checked") === "true" ? "[x] " : "[ ] ");
        if (icons.length) line += "(" + icons.join(",") + ") ";
        line += JSON.stringify(norm(label ? label.textContent : r.getAttribute("aria-label")));
        if (desc && norm(desc.textContent)) line += "  desc=" + JSON.stringify(norm(desc.textContent));
        if (detail && norm(detail.textContent)) line += "  detail=" + JSON.stringify(norm(detail.textContent));
        if (sep && norm(sep.textContent)) line += "  separator=" + JSON.stringify(norm(sep.textContent));
        if (btns.length) line += "  item-buttons=" + JSON.stringify(btns);
        // some rows carry their description/detail only in the accessible label: show it when it says more
        const aria = norm(r.getAttribute("aria-label") || "");
        const shown = [label && label.textContent, desc && desc.textContent, detail && detail.textContent].map(norm).join(" ");
        if (aria && aria !== norm(label ? label.textContent : "") && !shown.includes(aria)) line += "  aria=" + JSON.stringify(aria);
        out.push(line);
      }
    }
    // Dialogs
    for (const d of document.querySelectorAll(".monaco-dialog-box")) {
      if (!vis(d)) continue;
      out.push("DIALOG:");
      const icon = d.querySelector(".dialog-message-row .codicon");
      if (icon) out.push("  icon: " + [...icon.classList].filter((c) => c.startsWith("codicon-")).join(" "));
      const t = d.querySelector(".dialog-message-text"); if (t) out.push("  message: " + norm(t.textContent));
      const det = d.querySelector(".dialog-message-detail"); if (det && norm(det.textContent)) out.push("  detail: " + norm(det.textContent));
      const body = d.querySelector(".dialog-message-body");
      if (body) for (const para of body.querySelectorAll(".rendered-markdown")) if (norm(para.textContent)) out.push("  body: " + norm(para.textContent));
      const dlinks = [...d.querySelectorAll(".dialog-message-container a")].map((a) => norm(a.textContent) + " -> " + (a.getAttribute("data-href") || a.getAttribute("href") || ""));
      if (dlinks.length) out.push("  links: " + dlinks.join(" | "));
      const cb = d.querySelector(".dialog-checkbox-row"); if (cb) out.push("  checkbox: " + norm(cb.textContent));
      const inputs = [...d.querySelectorAll("input")].filter((i) => i.type !== "checkbox"); for (const i of inputs) out.push("  input: placeholder=" + JSON.stringify(i.placeholder) + " value=" + JSON.stringify(i.value));
      out.push("  buttons: " + [...d.querySelectorAll(".dialog-buttons .monaco-button, .dialog-buttons .monaco-dropdown-button")].map((b) => (norm(b.textContent) || b.getAttribute("aria-label")) + (b.classList.contains("secondary") ? "" : " (primary)")).join(" | "));
    }
    // Notification toasts
    const toasts = [...document.querySelectorAll(".notifications-toasts .notification-toast-container")].filter(vis);
    for (const t of toasts) {
      out.push("NOTIFICATION:");
      const sev = t.querySelector(".notification-list-item-icon");
      if (sev) out.push("  severity: " + ([...sev.classList].find((c) => /codicon-(info|warning|error)/.test(c)) || "").replace("codicon-", ""));
      const m = t.querySelector(".notification-list-item-message"); if (m) out.push("  message: " + norm(m.textContent));
      const links = [...t.querySelectorAll(".notification-list-item-message a")].map((a) => norm(a.textContent) + " -> " + (a.getAttribute("href") || a.title || ""));
      if (links.length) out.push("  links: " + links.join(" | "));
      const src = t.querySelector(".notification-list-item-source"); if (src && norm(src.textContent)) out.push("  source: " + norm(src.textContent));
      const b = [...t.querySelectorAll(".notification-list-item-buttons-container .monaco-button")].map((x) => norm(x.textContent) + (x.classList.contains("secondary") ? "" : " (primary)")).filter(Boolean);
      if (b.length) out.push("  buttons: " + b.join(" | "));
      const acts = [...t.querySelectorAll(".notification-list-item-toolbar-container .action-label")].map((x) => x.getAttribute("aria-label")).filter(Boolean);
      if (acts.length) out.push("  toolbar: " + acts.join(" | "));
      const prog = t.querySelector(".monaco-progress-container");
      /* a determinate bar (class "discrete") also shows how far it is: the bar's width in percent (2026-10-02) */
      const pct = prog && prog.classList.contains("discrete") ? parseFloat((prog.querySelector(".progress-bit") || { style: {} }).style.width) : NaN;
      if (prog && vis(prog) && prog.classList.contains("active")) out.push("  progress: running" + (prog.classList.contains("infinite") ? " (infinite)" : "") + (isNaN(pct) ? "" : " " + Math.round(pct) + "%"));
    }
    // Context menu
    const menus = [...document.querySelectorAll(".context-view .monaco-menu, .monaco-menu-container .monaco-menu")].filter(vis);
    for (const m of menus) {
      out.push("CONTEXT MENU:");
      for (const it of m.querySelectorAll(".action-item")) {
        if (it.classList.contains("disabled") && !norm(it.textContent)) continue;
        const lab = it.querySelector(".action-label");
        if (!lab) continue;
        if (lab.classList.contains("separator")) { out.push("   ---"); continue; }
        const kb = it.querySelector(".keybinding");
        out.push("   - " + JSON.stringify(norm(lab.textContent) || lab.getAttribute("aria-label")) + (kb && norm(kb.textContent) ? "  key=" + norm(kb.textContent) : "") + (it.classList.contains("disabled") ? " [disabled]" : "") + (it.querySelector(".submenu-indicator") ? " [submenu]" : ""));
      }
    }
    // Hover
    const hov = [...document.querySelectorAll(".workbench-hover, .monaco-hover")].filter(vis);
    for (const h of hov) if (norm(h.textContent)) out.push("HOVER: " + norm(h.textContent).slice(0, 500));
    // Editor suggest widget (IntelliSense list): not a quick input, and the HOVER line shows only the focused item's
    // details; list its visible rows (2026-09-28, F-0810 misread a full Feature-id list as one item)
    // (the widget is position:fixed, so offsetParent is null: check its size and style instead of vis())
    const shown = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
    for (const sw of [...document.querySelectorAll(".suggest-widget")].filter(shown)) {
      const rows = [...sw.querySelectorAll(".monaco-list-row")].filter(shown).map((r) => (r.classList.contains("focused") ? "*" : "") + (r.getAttribute("aria-label") || norm(r.textContent)));
      const msg = [...sw.querySelectorAll(".message")].filter(shown).map((m) => norm(m.textContent)).join(" ");
      out.push(`SUGGEST: ${rows.length} visible row(s)${msg ? ", message: " + msg : ""} (the list scrolls; * = focused)`);
      for (const r of rows.slice(0, 30)) out.push("   - " + JSON.stringify(r.slice(0, 200)));
    }
    // Status bar
    const sb = document.querySelector("#workbench\\.parts\\.statusbar, .part.statusbar");
    if (sb) {
      const items = [...sb.querySelectorAll(".statusbar-item")].filter(vis).map((i) => {
        const a = i.querySelector("a, .statusbar-item-label") || i;
        const txt = norm(a.textContent);
        const aria = a.getAttribute("aria-label") || i.getAttribute("aria-label") || "";
        return (i.id ? i.id + "=" : "") + JSON.stringify(txt || aria) + (aria && aria !== txt ? " aria=" + JSON.stringify(aria) : "");
      });
      out.push("STATUS BAR: " + items.join(" ; "));
    }
    // Banner
    const banner = document.querySelector(".part.banner");
    if (vis(banner) && norm(banner.textContent)) out.push("BANNER: " + norm(banner.textContent));
    // Active side bar / panel titles
    const sbTitle = document.querySelector(".part.sidebar .composite.title h2, .part.sidebar .title-label h2");
    if (vis(sbTitle)) out.push("SIDE BAR: " + norm(sbTitle.textContent));
    const panes = [...document.querySelectorAll(".part.sidebar .pane-header")].filter(vis).map((h) => norm((h.querySelector("h3") || h).textContent) + (h.getAttribute("aria-expanded") === "true" ? " (expanded)" : " (collapsed)"));
    if (panes.length) out.push("SIDE BAR SECTIONS: " + panes.join(" | "));
    const welcome = [...document.querySelectorAll(".part.sidebar .welcome-view-content")].filter(vis).map((w) => norm(w.innerText || w.textContent));
    for (const w of welcome) out.push("WELCOME VIEW: " + w);
    const tab = document.querySelector(".tabs-container .tab.active");
    if (tab) out.push("ACTIVE EDITOR: " + (tab.getAttribute("aria-label") || norm(tab.textContent)));
    // every open tab in every editor group (a second group, e.g. a log the extension opens beside the file, was missed
    // when only the active tab was reported; 2026-09-27, F-0410)
    const groups = [...document.querySelectorAll(".editor-group-container")].filter(vis).map((g) =>
      [...g.querySelectorAll(".tabs-container .tab")].map((t) => (t.classList.contains("active") ? "*" : "") + (t.getAttribute("aria-label") || norm(t.textContent))));
    if (groups.length > 1 || (groups[0] && groups[0].length > 1))
      out.push("EDITOR TABS: " + groups.map((g, i) => `[group ${i + 1}] ` + g.join(" | ")).join(" ; "));
    return out.join("\n");
  });
}

/* The same screen as snapshotState, as one structured object (LAB_JSON=1); kept separate so the text output stays
   byte-identical. */
/* athena on kit #241 (A): a log of every notification text the window shows, kept in the page itself, so a stage shorter
   than one poll (F-2403 "Downloading/Installing VS Code Server" on a fast host) is still seen. Each appearance (a new toast,
   or a toast whose text changes) is one entry {seq, text}; `epoch` names the log, which a reload starts afresh. Installed
   by the resident `notification-log-keep` (an init script, so a reloaded or new page has it from its first moment), and by
   the first lab call as the fallback. Texts only; read by `notifications-seen` for the wait condition notification_seen,
   never part of an observation. */
const installNotificationLog = () => {
  if (globalThis.__labNotificationLog) return;
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const log = { epoch: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), seen: [] };
  const last = new WeakMap();
  const scan = () => {
    for (const m of document.querySelectorAll(".notifications-toasts .notification-list-item-message")) {
      const t = norm(m.textContent);
      if (t && last.get(m) !== t) { last.set(m, t); log.seen.push({ seq: log.seen.length, text: t }); }
    }
  };
  globalThis.__labNotificationLog = log;
  scan();
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
};

async function snapshotData(page) {
  if (!page.url().includes("workbench")) {
    return await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const fields = [...document.querySelectorAll("input, textarea, select")].map((el) => {
        const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || el.name || el.tagName.toLowerCase();
        const val = el.tagName === "SELECT" ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : "") : (el.type === "checkbox" ? String(el.checked) : el.value);
        return { label: norm(label), value: norm(val).slice(0, 300) };
      });
      const text = (document.body ? document.body.innerText : "").split("\n").map(norm).filter(Boolean).join("\n").slice(0, 6000);
      return { auxiliary: true, title: document.title, fields, text };
    });
  }
  await page.evaluate(installNotificationLog).catch(() => {});
  return await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const codicons = (el) => [...el.classList].filter((c) => c.startsWith("codicon-"));
    const out = { auxiliary: false, title: document.title, quickInput: { visible: false }, dialogs: [], notifications: [], contextMenus: [], hovers: [], suggest: [], statusBar: [], banner: null, sideBar: null, sideBarSections: [], welcome: [], activeEditor: null, editorTabs: [] };
    // Quick input
    const qi = document.querySelector(".quick-input-widget");
    if (vis(qi)) {
      const q = { visible: true, title: null, placeholder: null, value: null, message: null, count: null, titleButtons: [], buttons: [], multiSelect: null, items: [] };
      const title = qi.querySelector(".quick-input-title");
      if (title && norm(title.textContent)) q.title = norm(title.textContent);
      const input = qi.querySelector(".quick-input-box input");
      if (input) { q.placeholder = input.getAttribute("placeholder") || ""; q.value = input.value; }
      const msg = qi.querySelector(".quick-input-message");
      if (msg && norm(msg.textContent)) q.message = norm(msg.textContent);
      const count = qi.querySelector(".quick-input-count");
      if (vis(count) && norm(count.textContent)) q.count = norm(count.textContent);
      q.titleButtons = [...qi.querySelectorAll(".quick-input-titlebar .action-label, .quick-input-inline-action-bar .action-label")].filter(vis).map((b) => b.getAttribute("aria-label") || b.title).filter(Boolean);
      q.buttons = [...qi.querySelectorAll(".quick-input-action .monaco-button, .quick-input-ok .monaco-button")].filter(vis).map((b) => norm(b.textContent));
      const multi = qi.querySelector(".quick-input-check-all");
      if (vis(multi)) q.multiSelect = { allChecked: !!multi.checked };
      const rows = [...qi.querySelectorAll(".quick-input-list .monaco-list-row")].filter(vis);
      rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      for (const r of rows) {
        let sep = r.querySelector(".quick-input-list-separator");
        if (sep && (sep.offsetParent === null || getComputedStyle(sep).display === "none")) sep = null;
        const label = r.querySelector(".quick-input-list-rows .monaco-icon-label .label-name, .quick-input-list-label .label-name, .monaco-icon-name-container");
        const desc = r.querySelector(".label-description");
        const detail = r.querySelector(".quick-input-list-detail, .quick-input-list-row-detail");
        const cb = r.querySelector("input[type=checkbox], .quick-input-list-checkbox");
        const icons = [...r.querySelectorAll(".quick-input-list-rows .codicon, .monaco-icon-label-container .codicon")].filter((i) => !i.closest(".quick-input-list-entry-action-bar")).map((i) => [...i.classList].find((c) => c.startsWith("codicon-") && c !== "codicon-modifier-spin")).filter(Boolean);
        const btns = [...r.querySelectorAll(".quick-input-list-entry-action-bar .action-label")].map((b) => b.getAttribute("aria-label") || b.title).filter(Boolean);
        const lab = norm(label ? label.textContent : r.getAttribute("aria-label"));
        const aria = norm(r.getAttribute("aria-label") || "");
        const shown = [label && label.textContent, desc && desc.textContent, detail && detail.textContent].map(norm).join(" ");
        q.items.push({
          label: lab, description: desc && norm(desc.textContent) ? norm(desc.textContent) : null, detail: detail && norm(detail.textContent) ? norm(detail.textContent) : null,
          separator: sep && norm(sep.textContent) ? norm(sep.textContent) : null, focused: r.classList.contains("focused"),
          checked: cb ? !!(cb.checked || cb.getAttribute("aria-checked") === "true" || r.getAttribute("aria-checked") === "true") : null,
          icons, buttons: btns, aria: aria && aria !== norm(label ? label.textContent : "") && !shown.includes(aria) ? aria : null,
        });
      }
      out.quickInput = q;
    }
    // Dialogs
    for (const d of document.querySelectorAll(".monaco-dialog-box")) {
      if (!vis(d)) continue;
      const icon = d.querySelector(".dialog-message-row .codicon");
      const t = d.querySelector(".dialog-message-text"), det = d.querySelector(".dialog-message-detail"), body = d.querySelector(".dialog-message-body");
      const cb = d.querySelector(".dialog-checkbox-row");
      const btns = [...d.querySelectorAll(".dialog-buttons .monaco-button, .dialog-buttons .monaco-dropdown-button")].map((b) => ({ label: norm(b.textContent) || b.getAttribute("aria-label"), primary: !b.classList.contains("secondary") }));
      out.dialogs.push({
        icon: icon ? codicons(icon).join(" ") : null, message: t ? norm(t.textContent) : null, detail: det && norm(det.textContent) ? norm(det.textContent) : null,
        body: body ? [...body.querySelectorAll(".rendered-markdown")].map((p) => norm(p.textContent)).filter(Boolean) : [],
        links: [...d.querySelectorAll(".dialog-message-container a")].map((a) => ({ text: norm(a.textContent), href: a.getAttribute("data-href") || a.getAttribute("href") || "" })),
        checkbox: cb ? (() => { const box = cb.querySelector("input[type=checkbox], [aria-checked]"); return { text: norm(cb.textContent), checked: box ? box.checked === true || box.getAttribute("aria-checked") === "true" : null }; })() : null,
        inputs: [...d.querySelectorAll("input")].filter((i) => i.type !== "checkbox").map((i) => ({ placeholder: i.placeholder, value: i.value })),
        buttons: btns.map((b) => b.label), primary: (btns.find((b) => b.primary) || { label: null }).label,
      });
    }
    // Notification toasts
    for (const t of [...document.querySelectorAll(".notifications-toasts .notification-toast-container")].filter(vis)) {
      const sev = t.querySelector(".notification-list-item-icon"), m = t.querySelector(".notification-list-item-message"), src = t.querySelector(".notification-list-item-source");
      const b = [...t.querySelectorAll(".notification-list-item-buttons-container .monaco-button")].map((x) => ({ label: norm(x.textContent), primary: !x.classList.contains("secondary") })).filter((x) => x.label);
      const prog = t.querySelector(".monaco-progress-container");
      out.notifications.push({
        severity: sev ? ([...sev.classList].find((c) => /codicon-(info|warning|error)/.test(c)) || "").replace("codicon-", "") : null,
        text: m ? norm(m.textContent) : null,
        links: [...t.querySelectorAll(".notification-list-item-message a")].map((a) => ({ text: norm(a.textContent), href: a.getAttribute("href") || a.title || "" })),
        source: src && norm(src.textContent) ? norm(src.textContent) : null,
        buttons: b.map((x) => x.label), primary: (b.find((x) => x.primary) || { label: null }).label,
        toolbar: [...t.querySelectorAll(".notification-list-item-toolbar-container .action-label")].map((x) => x.getAttribute("aria-label")).filter(Boolean),
        progress: prog && vis(prog) && prog.classList.contains("active") ? (prog.classList.contains("infinite") ? "infinite" : "running") : null,
        /* only for a determinate bar, so other notifications keep their shape */
        ...(prog && vis(prog) && prog.classList.contains("active") && prog.classList.contains("discrete") && !isNaN(parseFloat((prog.querySelector(".progress-bit") || { style: {} }).style.width))
          ? { percent: Math.round(parseFloat(prog.querySelector(".progress-bit").style.width)) } : {}),
      });
    }
    // Context menus
    for (const m of [...document.querySelectorAll(".context-view .monaco-menu, .monaco-menu-container .monaco-menu")].filter(vis)) {
      const items = [];
      for (const it of m.querySelectorAll(".action-item")) {
        if (it.classList.contains("disabled") && !norm(it.textContent)) continue;
        const lab = it.querySelector(".action-label");
        if (!lab) continue;
        if (lab.classList.contains("separator")) { items.push({ separator: true }); continue; }
        const kb = it.querySelector(".keybinding");
        items.push({ label: norm(lab.textContent) || lab.getAttribute("aria-label"), key: kb && norm(kb.textContent) ? norm(kb.textContent) : null, disabled: it.classList.contains("disabled"), submenu: !!it.querySelector(".submenu-indicator") });
      }
      out.contextMenus.push(items);
    }
    // Hovers
    for (const h of [...document.querySelectorAll(".workbench-hover, .monaco-hover")].filter(vis)) if (norm(h.textContent)) out.hovers.push(norm(h.textContent).slice(0, 500));
    // Editor suggest widget
    const shown = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
    for (const sw of [...document.querySelectorAll(".suggest-widget")].filter(shown)) {
      const rows = [...sw.querySelectorAll(".monaco-list-row")].filter(shown).map((r) => ({ text: (r.getAttribute("aria-label") || norm(r.textContent)).slice(0, 200), focused: r.classList.contains("focused") }));
      const msg = [...sw.querySelectorAll(".message")].filter(shown).map((m) => norm(m.textContent)).join(" ");
      out.suggest.push({ rows: rows.slice(0, 30), message: msg || null });
    }
    // Status bar: id, text, accessible label, and the title attribute if the item has one (most items show their
    // tooltip as a hover that is not in the page until the mouse rests on it)
    const sb = document.querySelector("#workbench\\.parts\\.statusbar, .part.statusbar");
    if (sb) out.statusBar = [...sb.querySelectorAll(".statusbar-item")].filter(vis).map((i) => {
      const a = i.querySelector("a, .statusbar-item-label") || i;
      const aria = a.getAttribute("aria-label") || i.getAttribute("aria-label") || "";
      return { id: i.id || null, text: norm(a.textContent), aria: aria || null, tooltip: a.getAttribute("title") || i.getAttribute("title") || null };
    });
    const banner = document.querySelector(".part.banner");
    if (vis(banner) && norm(banner.textContent)) out.banner = norm(banner.textContent);
    const sbTitle = document.querySelector(".part.sidebar .composite.title h2, .part.sidebar .title-label h2");
    if (vis(sbTitle)) out.sideBar = norm(sbTitle.textContent);
    out.sideBarSections = [...document.querySelectorAll(".part.sidebar .pane-header")].filter(vis).map((h) => ({ title: norm((h.querySelector("h3") || h).textContent), expanded: h.getAttribute("aria-expanded") === "true" }));
    out.welcome = [...document.querySelectorAll(".part.sidebar .welcome-view-content")].filter(vis).map((w) => norm(w.innerText || w.textContent));
    const tab = document.querySelector(".tabs-container .tab.active");
    if (tab) out.activeEditor = tab.getAttribute("aria-label") || norm(tab.textContent);
    out.editorTabs = [...document.querySelectorAll(".editor-group-container")].filter(vis).map((g) =>
      [...g.querySelectorAll(".tabs-container .tab")].map((t) => ({ title: t.getAttribute("aria-label") || norm(t.textContent), active: t.classList.contains("active") })));
    return out;
  });
}

async function printState(page, delay = 1200) {
  await sleep(delay);
  if (JSON_MODE) { RESULT.state = await snapshotData(page); return; }
  console.log(await snapshotState(page));
}

async function openPalette(page, text) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("F1");  // "Show All Commands" on every platform (Control+Shift+P is Cmd+Shift+P on macOS)
  const input = page.locator(".quick-input-widget .quick-input-box input");
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill(">" + text);
  await sleep(700);
  return input;
}

async function qiRows(page) {
  return await page.$$eval(".quick-input-widget .quick-input-list .monaco-list-row", (rows) =>
    rows.filter((r) => r.offsetParent !== null).map((r, i) => {
      const l = r.querySelector(".label-name") || r.querySelector(".monaco-icon-label");
      return { i, label: (l ? l.textContent : r.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(), aria: r.getAttribute("aria-label") || "", top: r.getBoundingClientRect().top };
    }));
}

async function clickRow(page, want) {
  // The quick pick list is virtualized: only rows in view exist in the page. Look for an exact or prefix label match;
  // if the item is not rendered, walk the list with ArrowDown (which scrolls the active item into view) until it is.
  // Only then fall back to a loose aria-label match. Returns the label actually clicked, or null.
  const strict = (rows) => rows.find((r) => r.label === want) || rows.find((r) => r.label.startsWith(want));
  let rows = await qiRows(page);
  let hit = strict(rows);
  if (!hit) {
    // follow the focused row, like `lab items`; stop when the focus wraps back to where it started
    const focused = () => page.evaluate(() => {
      const r = document.querySelector(".quick-input-widget .quick-input-list .monaco-list-row.focused");
      if (!r) return null;
      const l = r.querySelector(".label-name") || r.querySelector(".monaco-icon-label");
      return (l ? l.textContent : r.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    });
    let start = await focused();
    for (let k = 0; k < 600 && !hit; k++) {
      await page.keyboard.press("ArrowDown");
      await sleep(60);
      const f = await focused();
      if (start === null) { start = f; continue; }
      if (f !== null && (f === want || f.startsWith(want))) { rows = await qiRows(page); hit = strict(rows); }
      if (f === start) break;
    }
  }
  if (!hit) hit = rows.find((r) => r.aria.includes(want));
  if (!hit) return null;
  const els = await page.$$(".quick-input-widget .quick-input-list .monaco-list-row");
  const visEls = [];
  for (const e of els) if (await e.isVisible()) visEls.push(e);
  if (!JSON_MODE) { await visEls[hit.i].click(); return hit.label; }
  /* LAB_JSON (2026-10-01, encode): a row's hover (a context-view) can lie over the next row when the mouse rests on
     the list after the previous click, and the click then waits 30 s for a target that never frees up (F-0419-AC2-2).
     Move the mouse off the list first, click with a short timeout, and if the row is still covered select it with
     the keyboard (ArrowDown to it, Enter), as a user would. Not for multi-select pickers, where Enter means accept. */
  await page.mouse.move(0, 0);
  await sleep(300);
  try {
    await visEls[hit.i].click({ timeout: 5000 });
    return hit.label;
  } catch (e) {
    if (await page.locator(".quick-input-widget .quick-input-check-all").isVisible().catch(() => false)) throw e;
    const focusedLabel = () => page.evaluate(() => {
      const r = document.querySelector(".quick-input-widget .quick-input-list .monaco-list-row.focused");
      if (!r) return null;
      const l = r.querySelector(".label-name") || r.querySelector(".monaco-icon-label");
      return (l ? l.textContent : r.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    });
    for (let k = 0; k < 600; k++) {
      if ((await focusedLabel()) === hit.label) { await page.keyboard.press("Enter"); if (RESULT) RESULT.pickedBy = "keyboard"; return hit.label; }
      await page.keyboard.press("ArrowDown");
      await sleep(60);
    }
    throw e;
  }
}

/* LAB_JSON: every rendered row of the open quick pick with the same fields `lab items` reads from the focused row,
   plus whether the rendered rows are the whole list (then no walk is needed, and nothing moves). */
function renderedQuickPickRows() {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const rowsAll = [...document.querySelectorAll(".quick-input-widget .quick-input-list .monaco-list-row")];
  const info = (r) => {
    const label = r.querySelector(".label-name") || r.querySelector(".monaco-icon-label");
    const desc = r.querySelector(".label-description");
    const detail = r.querySelector(".quick-input-list-detail, .quick-input-list-row-detail");
    let sep = r.querySelector(".quick-input-list-separator");
    if (sep && (sep.offsetParent === null || getComputedStyle(sep).display === "none" || !r.classList.contains("quick-input-list-separator-border") && !(r.querySelector(".quick-input-list-separator-as-item")) && getComputedStyle(sep).visibility === "hidden")) sep = null;
    const cb = r.querySelector("input[type=checkbox]");
    const icons = [...r.querySelectorAll(".codicon")].filter((i) => !i.closest(".quick-input-list-entry-action-bar")).map((i) => [...i.classList].find((c) => c.startsWith("codicon-") && c !== "codicon-modifier-spin")).filter(Boolean);
    return { index: Number(r.getAttribute("data-index")), label: norm(label ? label.textContent : r.getAttribute("aria-label")), desc: norm(desc && desc.textContent), detail: norm(detail && detail.textContent), sep: norm(sep && sep.textContent), checked: cb ? cb.checked : null, icons, focused: r.classList.contains("focused"), setsize: Number(r.getAttribute("aria-setsize") || 0), selectable: r.getAttribute("aria-posinset") !== null };
  };
  const rows = rowsAll.map(info).sort((a, b) => a.index - b.index);
  const n = rows.length;
  const contiguous = rows.every((r, i) => r.index === i);
  const total = rows.reduce((m, r) => Math.max(m, r.setsize), 0);
  return { rows, complete: n > 0 && contiguous && (total === 0 || total <= rows.filter((r) => r.selectable).length || total <= n), active: (rows.find((r) => r.focused) || {}).index ?? null, n, total };
}

async function treeRows(page, viewTitle) {
  return await page.evaluate((viewTitle) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const panes = [...document.querySelectorAll(".pane")];
    const pane = panes.find((p) => { const h = p.querySelector(".pane-header h3"); return h && norm(h.textContent).toLowerCase() === viewTitle.toLowerCase(); });
    if (!pane) return { error: "view not visible: " + viewTitle + " (visible: " + panes.map((p) => norm((p.querySelector(".pane-header h3") || {}).textContent)).filter(Boolean).join(", ") + ")" };
    const header = pane.querySelector(".pane-header");
    const titleActions = [...header.querySelectorAll(".actions .action-label")].map((a) => a.getAttribute("aria-label")).filter(Boolean);
    const rows = [...pane.querySelectorAll(".monaco-list-row")].map((r) => {
      const label = r.querySelector(".label-name, .monaco-highlighted-label");
      const desc = r.querySelector(".label-description");
      const icon = r.querySelector(".custom-view-tree-node-item-icon, .codicon:not(.monaco-tl-twistie)");
      let iconName = "";
      if (icon) { iconName = [...icon.classList].find((c) => c.startsWith("codicon-")) || ""; if (!iconName && icon.style.backgroundImage) iconName = icon.style.backgroundImage.replace(/.*\//, "").replace(/["')]/g, ""); }
      const acts = [...r.querySelectorAll(".actions .action-label")].map((a) => a.getAttribute("aria-label")).filter(Boolean);
      return { level: r.getAttribute("aria-level"), expanded: r.getAttribute("aria-expanded"), label: norm(label ? label.textContent : ""), desc: norm(desc ? desc.textContent : ""), aria: r.getAttribute("aria-label") || "", icon: iconName, title: (r.querySelector("[title]") || {}).title || "", actions: acts };
    });
    const welcome = [...pane.querySelectorAll(".welcome-view-content")].map((w) => norm(w.innerText || w.textContent));
    const welcomeLinks = [...pane.querySelectorAll(".welcome-view-content a, .welcome-view-content .monaco-button")].map((a) => ({ text: norm(a.textContent), href: a.getAttribute("data-href") || a.getAttribute("href") || null }));
    // the tree's own message line (e.g. VS Code core "There is no data provider registered that can provide view data.")
    // is not welcome content; report it too (2026-09-28, F-0904 took it for a blank body)
    for (const m of pane.querySelectorAll(".message")) {
      const r = m.getBoundingClientRect(), t = norm(m.innerText || m.textContent);
      if (t && r.width > 0 && r.height > 0 && getComputedStyle(m).display !== "none") welcome.push("(view message) " + t);
    }
    return { titleActions, rows, welcome, welcomeLinks, expanded: header.getAttribute("aria-expanded") };
  }, viewTitle);
}

/* the log files `lab log` reads: Dev Containers' (any path naming remote-containers, as always), the room's extension log
   folders (identity ids), and output channels (exthost/output_logging_<time>/<n>-<channel>.log) named by --channel or by the
   room's [lab] log_channels (LAB_LOG_CHANNELS, newline-separated, exported by the `lab` wrapper). A channel given
   explicitly is the only source. */
function logChannelFile(p, channels) {
  const m = /^\d+-(.+)\.log$/.exec(path.basename(p));
  return !!m && /[\/]output_logging_[^\/]+$/.test(path.dirname(p)) && channels.includes(m[1]);
}
function newestLogs(channel) {
  const base = LAB + "/user-data/logs";
  if (!fs.existsSync(base)) return [];
  const channels = channel ? [channel] : (process.env.LAB_LOG_CHANNELS || "").split("\n").filter(Boolean);
  const mine = (p) => channel ? logChannelFile(p, channels)
    : p.includes("remote-containers") || EXT_IDS.some((id) => p.includes("/" + id + "/")) || logChannelFile(p, channels);
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".log") && mine(p)) found.push(p); } };
  walk(base);
  return found.map((p) => ({ p, t: fs.statSync(p).mtimeMs })).sort((a, b) => b.t - a.t);
}

/* ===== Editor language features (2026-10-02): open, goto, suggest, hovertext, markers, tokens, folds, outline, breadcrumbs.
   Positions are 1-based lines and columns as Go to Line/Column takes them and the status bar shows them: visible columns,
   where a tab counts to the next tab stop. The Problems view and the token inspector count characters instead, so
   markers and the tokens of a line report character columns (equal to the visible ones on lines without tabs). Every verb takes positional arguments
   (`lab suggest 12:5 --file src/a.ts`) or exactly one JSON argument (`lab suggest '{"file":"src/a.ts","line":12,"col":5}'`);
   `file` is relative to the workspace folder and is opened through Quick Open first.
   Observation readers (obs*) only read the page and never click or type; they run inside the page together with the
   helpers of pageHelpers(). Action helpers (act*) press keys and run commands. Every wait gates on what is on screen
   (until: a reader polled until its reading satisfies a condition), never on a fixed sleep; settle() is the quiet wait:
   the same reading several polls in a row. The polls use page.evaluate: page.waitForFunction builds its predicate with
   new Function inside the page, which the workbench's Trusted Types policy refuses. Each verb leaves the editor as it found it: lists, hovers and the token inspector closed, folds and the
   suggest details pane as they were, typed text undone. */

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/* ---- observation (runs inside the page) ---- */

function pageHelpers() {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
  const activeEditor = () => {
    const g = document.querySelector(".editor-group-container.active") || document;
    const eds = [...g.querySelectorAll(".monaco-editor")].filter(shown);
    return eds.find((e) => e.classList.contains("focused")) || eds[eds.length - 1] || null;
  };
  /* the margin row (line number, fold icon) of a model line, if that line is rendered */
  const marginRow = (ed, line) => {
    if (!ed) return null;
    for (const n of ed.querySelectorAll(".margin-view-overlays .line-numbers")) if (norm(n.textContent) === String(line)) return n.parentElement;
    return null;
  };
  const codicon = (el, prefix) => { const c = el ? [...el.classList].find((x) => x.startsWith(prefix)) : null; return c ? c.slice("codicon-".length) : null; };
  const links = (el) => el ? [...el.querySelectorAll("a")].map((a) => ({ text: norm(a.textContent), href: a.getAttribute("data-href") || a.getAttribute("href") || "" })) : [];
  return { norm, shown, activeEditor, marginRow, codicon, links };
}

/* an expression that runs `reader(arg)` in the page; with `pred`, it yields the reading only when pred(reading, arg) holds */
function inPage(reader, arg, pred) {
  return "(() => { const { norm, shown, activeEditor, marginRow, codicon, links } = (" + pageHelpers.toString() + ")();"
    + " const __a = " + JSON.stringify(arg === undefined ? null : arg) + ";"
    + " const __r = (" + reader.toString() + ")(__a);"
    + (pred ? " return (" + pred.toString() + ")(__r, __a) ? __r : null; })()" : " return __r; })()");
}

/* cursor position (status bar "Ln X, Col Y"), active editor tab, and whether a quick input is open */
function obsCursor() {
  const item = [...document.querySelectorAll(".statusbar-item")].find((i) => /^Ln \d+, Col \d+/.test(norm(i.textContent)));
  const m = item ? /^Ln (\d+), Col (\d+)/.exec(norm(item.textContent)) : null;
  const tab = document.querySelector(".editor-group-container.active .tabs-container .tab.active") || document.querySelector(".tabs-container .tab.active");
  const qi = document.querySelector(".quick-input-widget");
  return { line: m ? Number(m[1]) : null, col: m ? Number(m[2]) : null, editor: tab ? (tab.getAttribute("aria-label") || norm(tab.textContent)) : null, quickInput: shown(qi) };
}

/* the active editor: its tab title, whether a quick input is open, and its path inside the workspace from the breadcrumb
   bar's folder and file items (null without breadcrumbs). The tab title alone is not enough: files in different folders
   can share a name (".ssh/config"). */
function obsActiveFile() {
  const g = document.querySelector(".editor-group-container.active") || document;
  const tab = g.querySelector(".tabs-container .tab.active") || document.querySelector(".tabs-container .tab.active");
  const bar = [...g.querySelectorAll(".breadcrumbs-control")].find(shown);
  /* the items up to and including the file's (folder items carry no icon class; symbol items follow the file) */
  const items = bar ? [...bar.querySelectorAll(".monaco-breadcrumb-item")].filter(shown) : [];
  const fileAt = items.findIndex((it) => (it.querySelector(".monaco-icon-label") || it).classList.contains("file-icon"));
  const parts = fileAt < 0 ? [] : items.slice(0, fileAt + 1).map((it) => norm((it.querySelector(".label-name") || it).textContent));
  return { editor: tab ? (tab.getAttribute("aria-label") || norm(tab.textContent)) : null, quickInput: shown(document.querySelector(".quick-input-widget")), path: parts.length ? parts.join("/") : null };
}

/* the rendered rows of the open quick input; a.want picks the row labelled a.want (a.endsWith: or "<Category>: a.want"),
   preferring a.dir as its description (Quick Open shows a file's folder there) */
function obsQuickRows(a) {
  const qi = document.querySelector(".quick-input-widget");
  if (!shown(qi)) return { open: false, rows: [], hit: null };
  const input = qi.querySelector(".quick-input-box input");
  const rows = [...qi.querySelectorAll(".quick-input-list .monaco-list-row")].filter(shown).map((r) => {
    const l = r.querySelector(".label-name") || r.querySelector(".monaco-icon-label");
    const d = r.querySelector(".label-description");
    return { index: Number(r.getAttribute("data-index")), label: norm(l ? l.textContent : r.getAttribute("aria-label")), description: norm(d && d.textContent), focused: r.classList.contains("focused") };
  }).sort((x, y) => x.index - y.index);
  let hit = null;
  if (a && a.want) {
    const c = rows.filter((r) => r.label === a.want || (a.endsWith && r.label.endsWith(": " + a.want)));
    /* the workspace's own file first: Quick Open describes it by its folder exactly ("" at the root); a recently opened
       file outside the workspace (~/…/.ssh) only matches the loose suffixes, which are the fallback (remote-ssh-edit,
       2026-10-06: the HOME ~/.ssh/config, ranked first by history, was picked for ".ssh/config") */
    hit = (a.dir ? c.find((r) => r.description === a.dir) || c.find((r) => r.description.endsWith("/" + a.dir) || r.description.endsWith(a.dir))
                 : c.find((r) => !r.description)) || c[0] || null;
  }
  return { open: true, value: input ? input.value : null, rows, hit };
}

/* the text of a rendered line (as drawn: tabs appear as spaces) */
function obsLineText(a) {
  const row = marginRow(activeEditor(), a.line);
  if (!row) return null;
  const top = row.style.top;
  const v = [...activeEditor().querySelectorAll(".view-lines .view-line")].find((x) => x.style.top === top);
  return v ? v.textContent.replace(/ /g, " ") : null;
}

/* the suggest widget: state, rendered rows, the focused row, and the details pane */
function obsSuggest() {
  const sw = [...document.querySelectorAll(".suggest-widget")].find((w) => w.classList.contains("visible") && shown(w));
  if (!sw) return { visible: false };
  const msgEl = sw.querySelector(".message");
  const message = msgEl && shown(msgEl) ? norm(msgEl.textContent) : null;
  const rows = [...sw.querySelectorAll(".monaco-list-row")].map((r) => {
    const lab = r.querySelector(".left .monaco-icon-label");
    let kind = codicon(r.querySelector(".suggest-icon"), "codicon-symbol-") || codicon(r.querySelector(".suggest-icon"), "codicon-");
    if (!kind && lab) kind = lab.classList.contains("folder-icon") ? "folder" : lab.classList.contains("file-icon") ? "file" : null;
    if (!kind && r.querySelector(".icon.customcolor")) kind = "color";
    const name = r.querySelector(".left .label-name"), sig = r.querySelector(".signature-label"), qual = r.querySelector(".qualifier-label"), det = r.querySelector(".details-label");
    const aria = r.getAttribute("aria-label") || "";
    return {
      order: Number(r.getAttribute("data-index")), label: norm(name ? name.textContent : ""), labelDetail: norm(sig && sig.textContent) || null,
      qualifier: norm(qual && qual.textContent) || null, description: det && shown(det) ? norm(det.textContent) || null : null, kind,
      deprecated: !!(lab && lab.classList.contains("deprecated")), focused: r.classList.contains("focused"),
      /* the item has a detail or documentation the details pane can show */
      canExpand: !!r.querySelector(".right.can-expand-details"),
      /* the details pane's text is final for a row once the row is re-rendered resolved: its accessible label then ends
         in ", docs: ..." (only while the details pane is shown) */
      resolved: aria.includes(", docs: "), setsize: Number(r.getAttribute("aria-setsize") || 0),
    };
  }).sort((x, y) => x.order - y.order);
  const dw = [...document.querySelectorAll(".suggest-details")].find(shown);
  let details = null;
  if (dw) {
    const type = dw.querySelector(".type"), docs = dw.querySelector(".docs");
    details = { type: dw.classList.contains("no-type") ? null : (type ? type.innerText.trim() : null) || null, docs: dw.classList.contains("no-docs") ? null : (docs ? docs.innerText.trim() : null) || null, links: links(docs) };
  }
  /* total: the list's size from aria-setsize (0 if the rows do not carry it: the list is virtualized, so the rendered
     rows are not the whole list) */
  return { visible: true, loading: message === "Loading...", message, showsDetails: sw.classList.contains("shows-details"), rows, focused: rows.find((r) => r.focused) || null, total: rows.reduce((m, r) => Math.max(m, r.setsize), 0), details };
}

/* the editor's content hover (not the workbench hovers of views and the status bar) */
function obsContentHover() {
  const root = [...document.querySelectorAll(".monaco-resizable-hover")].find(shown) || [...document.querySelectorAll(".monaco-editor .monaco-hover")].find(shown);
  if (!root) return { visible: false };
  const hover = root.matches(".monaco-hover") ? root : root.querySelector(".monaco-hover") || root;
  const content = hover.querySelector(".monaco-hover-content") || hover;
  const parts = [];
  for (const row of content.querySelectorAll(".hover-row")) {
    if (row.classList.contains("status-bar")) continue;
    const marker = row.querySelector(".marker.hover-contents");
    const el = marker || row;
    const text = (el.innerText || "").trim();
    if (text) parts.push({ kind: marker ? "marker" : "markdown", text, links: links(el) });
  }
  const actions = [...content.querySelectorAll(".hover-row.status-bar .action-container")].filter(shown).map((x) => norm(x.textContent)).filter(Boolean);
  const text = parts.map((p) => p.text).join("\n\n");
  return { visible: true, loading: !parts.length || parts.every((p) => /^Loading\.\.\.$/.test(p.text)), text, parts, actions };
}

/* the "Developer: Inspect Editor Tokens and Scopes" widget (VS Code core) */
function obsTokenInspector() {
  const w = [...document.querySelectorAll(".token-inspect-widget")].find(shown);
  if (!w) return { visible: false };
  const h2 = w.querySelector("h2.tiw-token");
  if (!h2) return { visible: true, ready: false, message: norm(w.textContent) };
  const lenEl = h2.querySelector(".tiw-token-length");
  const rows = {};
  for (const tr of w.querySelectorAll("table.tiw-metadata-table tr")) {
    const k = norm((tr.querySelector(".tiw-metadata-key") || {}).textContent), v = tr.querySelector(".tiw-metadata-value");
    if (!k || !v || k in rows) continue;
    rows[k] = v.classList.contains("tiw-metadata-scopes") ? [...v.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean) : norm(v.textContent);
  }
  const m = /^(\d+) chars?$/.exec(norm(lenEl && lenEl.textContent));
  return { visible: true, ready: true, text: [...h2.childNodes].filter((n) => n !== lenEl).map((n) => n.textContent).join(""), length: m ? Number(m[1]) : null, rows };
}

/* the focused row of the Problems view */
function obsProblems() {
  const pane = [...document.querySelectorAll(".markers-panel")].find(shown);
  if (!pane) return { visible: false };
  const rows = [...pane.querySelectorAll(".monaco-list-row")].filter(shown);
  const msg = [...pane.querySelectorAll(".message-box-container, .markers-panel-message")].filter(shown).map((x) => norm(x.textContent)).join(" ");
  const r = rows.find((x) => x.classList.contains("focused"));
  if (!r) return { visible: true, rows: rows.length, message: msg || null, row: null };
  const base = { index: Number(r.getAttribute("data-index")), level: Number(r.getAttribute("aria-level") || 0), expanded: r.getAttribute("aria-expanded"), aria: r.getAttribute("aria-label") || "" };
  const res = r.querySelector(".resource-label-container");
  if (res) return { visible: true, rows: rows.length, row: { ...base, type: "resource", name: norm((res.querySelector(".label-name") || res).textContent), folder: norm((res.querySelector(".label-description") || {}).textContent) || null } };
  const icon = r.querySelector(".marker-icon");
  if (icon) {
    const ln = /\[Ln (\d+), Col (\d+)\]/.exec(norm((r.querySelector(".marker-line") || {}).textContent));
    const codeEl = r.querySelector(".marker-code");
    const codeLink = codeEl && codeEl.closest("a");
    return { visible: true, rows: rows.length, row: { ...base, type: "marker", severity: ["error", "warning", "info", "ignore"].find((s) => icon.classList.contains(s)) || null,
      shown: [...r.querySelectorAll(".marker-message")].map((x) => x.innerText.trim()).join("\n"), source: norm((r.querySelector(".marker-source") || {}).textContent) || null,
      code: codeEl ? norm(codeEl.textContent) || null : null, codeHref: codeLink ? codeLink.getAttribute("href") || codeLink.title || null : null,
      start: ln ? [Number(ln[1]), Number(ln[2])] : null } };
  }
  const ri = r.querySelector(".related-info-resource");
  if (ri) {
    const ln = /\[Ln (\d+), Col (\d+)\]/.exec(norm((r.querySelector(".marker-line") || {}).textContent));
    return { visible: true, rows: rows.length, row: { ...base, type: "related", file: norm(ri.textContent), start: ln ? [Number(ln[1]), Number(ln[2])] : null, message: norm((r.querySelector(".marker-description") || {}).textContent) } };
  }
  return { visible: true, rows: rows.length, row: { ...base, type: "other" } };
}

/* the cursor and the squiggles of one line, in the editor's content coordinates (style left/top) */
function obsSquiggles(a) {
  const ed = activeEditor();
  if (!ed) return null;
  const cur = ed.querySelector(".cursors-layer .cursor");
  const row = marginRow(ed, a.line), next = marginRow(ed, a.line + 1);
  const at = (top) => {
    const out = [];
    for (const d of ed.querySelectorAll(".view-overlays > div")) {
      if (d.style.top !== top) continue;
      for (const s of d.querySelectorAll(".cdr")) {
        const cls = [...s.classList].find((c) => /^squiggly-(error|warning|info|hint)$/.test(c));
        if (cls) out.push({ severity: cls.slice(9), left: parseFloat(s.style.left), right: parseFloat(s.style.left) + parseFloat(s.style.width) });
      }
    }
    return out;
  };
  return { cursor: cur ? { left: parseFloat(cur.style.left), top: cur.style.top } : null, rendered: !!row, squiggles: row ? at(row.style.top) : [], nextLine: next ? at(next.style.top) : null };
}

/* the fold icon of a rendered line: "expanded", "collapsed" or null (no folding range starts there) */
function obsFold(a) {
  const row = marginRow(activeEditor(), a.line);
  if (!row) return { rendered: false, state: null };
  const icon = row.querySelector("[class*='codicon-folding-']");
  const c = icon ? [...icon.classList].find((x) => x.startsWith("codicon-folding-")) : null;
  return { rendered: true, state: c ? (c.includes("collapsed") ? "collapsed" : "expanded") : null };
}

/* the Outline view: its message, how many rows it shows, and its focused row */
function obsOutline() {
  const pane = [...document.querySelectorAll(".pane")].find((p) => norm((p.querySelector(".pane-header h3") || {}).textContent).toLowerCase() === "outline" && shown(p.querySelector(".pane-body")));
  if (!pane) return { visible: false };
  const msg = pane.querySelector(".outline-message");
  const rows = [...pane.querySelectorAll(".monaco-list-row")].filter(shown);
  const r = rows.find((x) => x.classList.contains("focused"));
  const row = r ? { index: Number(r.getAttribute("data-index")), level: Number(r.getAttribute("aria-level") || 1), expanded: r.getAttribute("aria-expanded"),
    name: norm((r.querySelector(".label-name") || {}).textContent), detail: norm((r.querySelector(".label-description") || {}).textContent) || null,
    kind: [...r.querySelectorAll("[class*='codicon-symbol-']")].map((e) => codicon(e, "codicon-symbol-")).find(Boolean) || null } : null;
  return { visible: true, message: msg && shown(msg) ? norm(msg.textContent) : null, rows: rows.length, row };
}

/* the breadcrumb bar of the active editor group */
function obsBreadcrumbs() {
  const g = document.querySelector(".editor-group-container.active") || document;
  const bar = [...g.querySelectorAll(".breadcrumbs-control")].find(shown);
  if (!bar) return { visible: false, items: [] };
  const items = [...bar.querySelectorAll(".monaco-breadcrumb-item")].filter(shown).map((it) => {
    const lab = it.querySelector(".monaco-icon-label") || it;
    const kind = lab.classList.contains("folder-icon") ? "folder" : lab.classList.contains("file-icon") ? "file"
      : [it, ...it.querySelectorAll("[class*='codicon-symbol-']")].map((e) => codicon(e, "codicon-symbol-")).find(Boolean) || null;
    return { name: norm((it.querySelector(".label-name") || it).textContent), kind };
  });
  return { visible: true, items };
}

/* the panel part: its tabs, the terminal tabs, the Output channel, and how many non-empty lines it shows */
function obsPanel() {
  const part = document.querySelector(".part.panel");
  if (!shown(part)) return { visible: false };
  const tabs = [...part.querySelectorAll(".composite-bar .action-item")].filter(shown).map((it) => {
    const l = it.querySelector(".action-label"), b = it.querySelector(".badge-content");
    const label = norm([...(l ? l.childNodes : [])].filter((n) => !(n.nodeType === 1 && n.classList.contains("badge"))).map((n) => n.textContent).join("")) || norm(l && (l.getAttribute("aria-label") || l.title));
    return { label, active: it.classList.contains("checked"), badge: b && shown(b) ? norm(b.textContent) || null : null };
  });
  const front = tabs.find((t) => t.active) || null;
  let terminals = [...part.querySelectorAll(".terminal-tabs-entry")].filter(shown).map((e) => ({ name: norm((e.querySelector(".label-name") || e).textContent), active: e.classList.contains("is-active") }));
  if (!terminals.length) { const one = [...part.querySelectorAll(".single-terminal-tab")].find(shown); if (one) terminals = [{ name: norm(one.textContent), active: true }]; }
  const ae = document.activeElement;
  /* the Output view's channel switcher shows the channel in front (a selection submenu in the view's title bar; a select
     box in older builds) */
  let channel = null;
  if (front && /^output$/i.test(front.label)) {
    const sel = [...part.querySelectorAll(".title-actions select, .title-actions .monaco-select-box")].find(shown);
    if (sel && sel.tagName === "SELECT") channel = norm((sel.selectedOptions[0] || {}).textContent) || null;
    if (!channel) {
      const sw = [...part.querySelectorAll(".title-actions .action-item")].filter(shown).find((a) => /Switch Output/i.test([a.getAttribute("aria-label"), a.title, ...[...a.querySelectorAll("[aria-label],[title]")].map((x) => x.getAttribute("aria-label") || x.title)].join(" ")));
      if (sw) channel = norm(sw.textContent) || null;
    }
  }
  /* a terminal draws its text on a canvas (GPU renderer): its rows are empty in the page unless the screen-reader
     buffer is on, so its line count is unknown (null) rather than 0 */
  const termWrap = [...part.querySelectorAll(".terminal-wrapper.active")].find(shown);
  const ed = termWrap ? null : [...part.querySelectorAll(".monaco-editor")].find(shown);
  const body = [...part.querySelectorAll(".composite.panel, .pane-body")].find(shown);
  let lines;
  if (termWrap) {
    const rows = [...termWrap.querySelectorAll(".xterm-rows > div, .xterm-accessibility-tree > div")].filter((d) => norm(d.textContent));
    lines = rows.length ? rows.length : null;
  } else lines = ed ? [...ed.querySelectorAll(".view-line")].filter((v) => norm(v.textContent)).length
    : body ? (body.innerText || "").split("\n").filter((x) => norm(x)).length : 0;
  return {
    visible: true, position: ["bottom", "right", "left", "top"].find((c) => part.classList.contains(c)) || null,
    maximized: !shown(document.querySelector(".part.editor")), focused: !!(ae && part.contains(ae)),
    tabs, front: front ? front.label : null,
    terminals: terminals.length ? terminals : null, terminalFocused: !!(ae && ae.closest && ae.closest(".terminal-wrapper")),
    outputChannel: channel, visibleLines: lines,
  };
}

/* the open Settings editor (kit #289, K6): the tab in front, the tabs shown, and every setting row the search shows, in
   screen order: its id (the row's own data-key), its title as shown, its control, the control's value (a checkbox's state,
   a box's text, an enum's shown choice; none for a list, an object or an "Edit in settings.json" link), whether the row
   is modified in this tab's scope, the indicators beside its title, its description as text (code spans and links as
   their text) and the validation message under it */
function obsSettingsEditor() {
  const ed = [...document.querySelectorAll(".settings-editor")].find(shown);
  if (!ed) return { open: false };
  const tabs = [...ed.querySelectorAll(".settings-tabs-widget .action-item")].filter(shown).map((t) => {
    const l = t.querySelector(".action-label") || t;
    return { label: norm(t.textContent), active: l.classList.contains("checked"), disabled: t.classList.contains("disabled") };
  });
  const CONTROLS = { bool: "checkbox", text: "text", multilineText: "text", number: "number", enum: "enum", list: "list",
    include: "list", exclude: "list", object: "object", boolObject: "object", complex: "json-link", complexObject: "json-link" };
  const rows = [...ed.querySelectorAll(".settings-tree-container .monaco-list-row")]
    .filter((r) => r.querySelector(".setting-item-contents[data-key]"))
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index)).map((r) => {
      const item = r.querySelector(".setting-item"), c = r.querySelector(".setting-item-contents");
      const kind = [...item.classList].map((x) => /^setting-item-(.+)$/.exec(x)).filter(Boolean).map((m) => m[1])[0] || null;
      const control = CONTROLS[kind] || kind;
      const box = r.querySelector(".setting-item-control input.input, .setting-item-control textarea");
      const check = r.querySelector(".setting-value-checkbox"), select = r.querySelector(".setting-item-control select");
      const value = control === "checkbox" ? (check ? check.getAttribute("aria-checked") === "true" : null)
        : control === "text" || control === "number" ? (box ? box.value : null)
        : control === "enum" ? (select && select.selectedOptions[0] ? norm(select.selectedOptions[0].textContent) : null) : null;
      const v = r.querySelector(".setting-item-validation-message");
      return {
        id: c.dataset.key,
        title: norm([r.querySelector(".setting-item-category"), r.querySelector(".setting-item-label")].map((e) => e ? e.textContent : "").join("")),
        control, value, modified: c.classList.contains("is-configured"),
        indicators: [...r.querySelectorAll(".setting-indicators-container .setting-indicator")].filter(shown).map((e) => norm(e.textContent)),
        description: norm((r.querySelector(".setting-item-description") || {}).textContent) || null,
        validation: c.classList.contains("invalid-input") && v ? norm(v.textContent) || null : null,
      };
    });
  const front = tabs.find((t) => t.active);
  return { open: true, tab: front ? front.label : null, tabs: tabs.map((t) => t.label), disabled: tabs.filter((t) => t.disabled).map((t) => t.label), rows };
}

/* ---- waits ---- */

const observe = (page, reader, arg) => page.evaluate(inPage(reader, arg));

/* wait until the page has drawn two more frames (at most 1 s): for widgets that render on the next animation frame */
const frames = (page) => page.evaluate("new Promise((r) => { const t = setTimeout(() => r(false), 1000); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(true); })); })");

/* Host sleep (2026-10-04): the lab hosts are guests of a Mac that sleeps; while it sleeps they are paused and the wall clock
   is stepped forward on resume, the monotonic one is not. Deadlines and timings here are monotonic (performance.now), so
   a sleep is never a timeout; hostSlept() is how far the wall clock ran ahead of it since this process started. */
function hostSlept() {
  const d = Date.now() - (performance.timeOrigin + performance.now());
  return d > 60000 ? Math.round(d / 1000) : 0;
}
function hostSleepNote() {
  const s = hostSlept();
  if (s) console.error("HOST SLEEP: the host slept about " + s + " s during this lab command; any timing measured across it " +
    "is invalid (record it as such), and what the window shows may have reconnected since.");
}

async function until(page, reader, pred, arg, timeout, what) {
  const expr = inPage(reader, arg), end = performance.now() + timeout;
  for (;;) {
    const r = await page.evaluate(expr);
    if (r !== null && r !== undefined && pred(r, arg)) return r;
    if (performance.now() >= end) throw new Error("timed out after " + timeout + " ms waiting for " + what + " (last reading: " + JSON.stringify(r).slice(0, 400) + ")");
    await page.waitForTimeout(50);  /* the poll interval of this state check */
  }
}

/* the quiet wait: the reading is the same for `polls` consecutive polls 50 ms apart (and pred holds) */
async function settle(page, reader, arg, pred, timeout, polls, what) {
  const end = performance.now() + timeout;
  let last = null, same = 0;
  while (performance.now() < end) {
    const r = await observe(page, reader, arg);
    const sig = JSON.stringify(r);
    if ((!pred || pred(r, arg)) && sig === last) { if (++same >= polls - 1) return r; } else same = 0;
    last = sig;
    await page.waitForTimeout(50);  /* the poll interval of this state check */
  }
  throw new Error("timed out after " + timeout + " ms waiting for " + what + " to settle");
}

/* ---- actions ---- */

function editorArgs(verb, args) {
  const o = { file: null, line: null, col: null, type: null };
  if (args.length === 1 && /^\s*\{/.test(args[0])) {
    const j = JSON.parse(args[0]);
    Object.assign(o, { file: j.file ?? null, line: j.line ?? null, col: j.col ?? null, type: j.type ?? j.trigger ?? null });
  } else {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--file") o.file = args[++i];
      else if (a === "--type") o.type = args[++i];
      else if (/^\d+(:\d+)?$/.test(a)) { const [l, c] = a.split(":"); o.line = Number(l); o.col = c ? Number(c) : null; }
      else if (/^\d+:/.test(a)) throw new Error(verb + ": a position is <line> or <line>:<col>, not " + JSON.stringify(a));
      else if (o.file === null && !a.startsWith("-")) o.file = a;
      else throw new Error(verb + ": unexpected argument " + JSON.stringify(a) + " (run: lab help)");
    }
  }
  if (o.file !== null && (typeof o.file !== "string" || !o.file || /^([\\/]|~|[A-Za-z]:)/.test(o.file) || o.file.split(/[\\/]/).includes("..")))
    throw new Error(verb + ": the file must be a path inside the workspace folder, relative to it: " + JSON.stringify(o.file));
  for (const k of ["line", "col"]) if (o[k] !== null && !(Number.isInteger(o[k]) && o[k] >= 1)) throw new Error(verb + ": " + k + " must be a positive integer");
  return o;
}

async function actPalette(page, text) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("F1");
  const input = page.locator(".quick-input-widget .quick-input-box input");
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill(text);
}

async function actPickHit(page, r) {
  if (r.hit.focused) await page.keyboard.press("Enter");
  /* the exact row, by its index: a text filter would also match longer labels ("Fold" in "Fold All") */
  else await page.locator(".quick-input-widget .quick-input-list .monaco-list-row[data-index='" + r.hit.index + "']").first().click({ timeout: 5000 });
  await until(page, obsQuickRows, (q) => !q.open, null, 5000, "the quick input to close");
}

/* run a command by its Command Palette title; endsWith: the title after any "<Category>: " prefix */
async function actRun(page, title, endsWith = false) {
  await actPalette(page, ">" + title);
  let r;
  try { r = await until(page, obsQuickRows, (q) => q.hit, { want: title, endsWith }, 5000, "the command \"" + title + "\" in the Command Palette"); }
  catch (e) { await page.keyboard.press("Escape"); throw e; }
  await actPickHit(page, r);
}

async function actGoto(page, line, col) {
  const v = ":" + line + (col ? ":" + col : "");
  await actPalette(page, v);
  await until(page, obsQuickRows, (q, a) => q.open && q.value === a.v && q.rows.length > 0, { v }, 5000, "the Go to Line/Column input");
  await page.keyboard.press("Enter");
  try { await until(page, obsCursor, (c, a) => !c.quickInput && c.line === a.line, { line }, 5000, "the cursor to reach line " + line); }
  catch (e) { await page.keyboard.press("Escape"); throw new Error("cannot go to " + v.slice(1) + " (outside the file?): " + e.message); }
  return await settle(page, obsCursor, null, (c) => c.line === line, 3000, 3, "the cursor position");
}

async function actOpen(page, file) {
  const parts = file.split(/[\\/]/), base = parts.pop(), dir = parts.join("/") || null, rel = file.replace(/\\/g, "/");
  /* the file is the active editor: by its path in the breadcrumbs, or (without breadcrumbs) by its tab title */
  /* the active editor is the file: its workspace-relative path, or that path under one root folder name (a multi-root
     workspace); never a longer path that merely ends the same (~/…/.ssh/config is not .ssh/config) */
  const isOpen = (x) => !x.quickInput && (x.path ? x.path === rel || (x.path.endsWith("/" + rel) && !x.path.slice(0, -rel.length - 1).includes("/"))
    : !!x.editor && (x.editor === base || x.editor.startsWith(base + ",") || x.editor.startsWith(base + " ")));
  /* the shortcut (nothing to do) only for the exact workspace-relative path: a suffix match took the HOME ~/.ssh/config,
     or second/.ssh/config, for ".ssh/config" and opened nothing (remote-ssh-edit, F-4204-AC8-3, F-4202-AC3-8,
     2026-10-06). A miss here only costs a Quick Open; after it, the picked row (chosen by its folder) is checked as before. */
  const cur = await observe(page, obsActiveFile);
  if (!cur.quickInput && cur.path === rel) return;
  await actPalette(page, file);
  let r;
  try { r = await until(page, obsQuickRows, (q) => q.hit, { want: base, dir }, 10000, JSON.stringify(file) + " in Quick Open"); }
  catch (e) { await page.keyboard.press("Escape"); throw e; }
  await actPickHit(page, r);
  await until(page, obsActiveFile, isOpen, null, 10000, JSON.stringify(file) + " to become the active editor");
}

async function actFocusEditor(page) {
  await actRun(page, "Focus Active Editor Group", true);
}

/* the number of lines of the active editor, from the Go to Line/Column prompt ("Type a line number to go to (from 1 to N).") */
async function actLineCount(page) {
  await actPalette(page, ":");
  const r = await until(page, obsQuickRows, (q) => q.open && q.rows.some((x) => /from 1 to \d+/.test(x.label)), null, 5000, "the Go to Line/Column prompt");
  await page.keyboard.press("Escape");
  await until(page, obsQuickRows, (q) => !q.open, null, 5000, "the quick input to close");
  return Number(/from 1 to (\d+)/.exec(r.rows.find((x) => /from 1 to \d+/.test(x.label)).label)[1]);
}

/* walk a keyboard-navigable tree or list from its first row; stop when ArrowDown no longer moves the focus */
async function actWalk(page, reader, read, max = 2000) {
  await page.keyboard.press("Home");
  let cur = await until(page, reader, (r) => r.visible && r.row, null, 5000, "a focused row");
  const out = [];
  for (let k = 0; k < max; k++) {
    out.push(read(cur.row));
    await page.keyboard.press("ArrowDown");
    try { cur = await until(page, reader, (r, a) => r.visible && r.row && r.row.index !== a.prev, { prev: cur.row.index }, 800, "the next row"); }
    catch (e) { if (/timed out/.test(e.message)) break; throw e; }
  }
  return out;
}

/* ---- verbs (each returns the payload; the caller prints it) ---- */

const where = (c) => ({ line: c.line, col: c.col });

async function verbOpen(page, o) {
  if (!o.file) throw new Error("open: which file? (lab open <path relative to the workspace folder>)");
  await actOpen(page, o.file);
  const c = await settle(page, obsCursor, null, null, 3000, 3, "the cursor position");
  return { editor: c.editor, path: (await observe(page, obsActiveFile)).path, position: where(c) };
}

async function verbGoto(page, o) {
  if (o.file) await actOpen(page, o.file);
  if (!o.line) throw new Error("goto: which position? (lab goto <line>[:<col>])");
  return { position: where(await actGoto(page, o.line, o.col)) };
}

async function verbSuggest(page, o) {
  if (o.file) await actOpen(page, o.file);
  if (o.line) await actGoto(page, o.line, o.col);
  let undo = null;
  if (o.type) {
    const c0 = await observe(page, obsCursor);
    undo = { line: c0.line, text: await observe(page, obsLineText, { line: c0.line }) };
    await page.keyboard.type(o.type);
  }
  let toggled = false, opened = false;
  try {
    const position = where(await settle(page, obsCursor, null, (c) => !c.quickInput, 3000, 3, "the cursor position"));
    await actRun(page, "Trigger Suggest");
    opened = true;
    let s = await until(page, obsSuggest, (w) => w.visible && !w.loading, null, 10000, "the suggest list");
    if (!s.rows.length) return { position, total: 0, message: s.message, preselected: null, items: [] };
    const preselected = s.focused ? s.focused.order : null;
    if (!s.focused) { await page.keyboard.press("ArrowDown"); s = await until(page, obsSuggest, (w) => w.visible && w.focused, null, 3000, "a focused suggestion"); }
    /* The details pane is a stored mode (Ctrl+Space, toggleSuggestionDetails, on every platform) that shows only for an
       item with something to expand. The mode is on if the pane shows, or if the focused row, once resolved, carries
       ", docs: " in its accessible label. If it is off, turn it on at the first expandable item (Ctrl+Space does
       nothing on another one) and turn it off again at the end. */
    s = await settle(page, obsSuggest, null, (w) => w.visible && !!w.focused, 3000, 4, "the focused suggestion");
    /* a list of one item: VS Code moves through the list only when it holds more than one suggestion, so ArrowDown
       would go to the editor, move the cursor and close the list (remote-ssh-edit, F-4203, 2026-10-06: the walk closed
       it and then timed out). Never press ArrowDown in it: read the single row where it is */
    const single = (s.total || s.rows.length) <= 1;
    if (!s.showsDetails && !s.focused.resolved) {
      const tried = new Set();
      while (!tried.has(s.focused.order)) {
        tried.add(s.focused.order);
        if (s.focused.canExpand) {
          await page.keyboard.press("Control+Space");
          s = await until(page, obsSuggest, (w) => w.visible && w.showsDetails, null, 3000, "the suggestion details pane");
          toggled = true;
          break;
        }
        if (single) break;
        await page.keyboard.press("ArrowDown");
        try { await until(page, obsSuggest, (w, a) => w.visible && w.focused && w.focused.order !== a.prev, { prev: s.focused.order }, 3000, "the next suggestion"); }
        catch (e) { if (/timed out/.test(e.message)) break; throw e; }
        s = await settle(page, obsSuggest, null, (w) => w.visible && !!w.focused, 3000, 4, "the focused suggestion");
      }
    }
    /* walk with ArrowDown, which wraps around at the end of the list: stop at the first item seen twice (or when the
       list's size is reached, or when ArrowDown no longer moves the focus: a list of one) */
    const items = new Map();
    for (let k = 0; k < 10000; k++) {
      let cur;
      /* a resolved row is re-rendered at once, its details pane on the next animation frame: wait for both */
      try { await until(page, obsSuggest, (w) => w.visible && w.focused && (!w.showsDetails || w.focused.resolved), null, 1500, "the focused suggestion to resolve"); await frames(page); cur = await observe(page, obsSuggest); }
      catch (e) {
        /* an item resolved while the details pane was hidden (the one focused when the list opened) keeps its short
           accessible label; its details were rendered when the pane opened: wait until they stop changing */
        if (!/timed out/.test(e.message)) throw e;
        try { cur = await settle(page, obsSuggest, null, (w) => w.visible && !!w.focused && !(w.details && w.details.type === "Loading..."), 5000, 6, "the details of the focused suggestion"); }
        catch (e2) {   /* say what the widget showed: a driver failure must be diagnosable, never recorded as behavior */
          if (!/timed out/.test(e2.message)) throw e2;
          const w = await observe(page, obsSuggest);
          throw new Error(e2.message + " (suggest widget then: " + JSON.stringify({ visible: !!w.visible, focused: w.focused ? w.focused.label : null,
            total: w.total, details: w.details ? String(w.details.type).slice(0, 60) : null, items_seen: items.size }) + ")");
        }
      }
      const f = cur.focused;
      if (items.has(f.order)) break;
      items.set(f.order, { order: f.order, label: f.label, labelDetail: f.labelDetail, qualifier: f.qualifier, description: f.description, kind: f.kind, deprecated: f.deprecated,
        detail: cur.details ? cur.details.type : null, documentation: cur.details ? cur.details.docs : null, links: cur.details ? cur.details.links : [], preselected: f.order === preselected });
      if ((s.total && items.size >= s.total) || single) break;
      await page.keyboard.press("ArrowDown");
      try { await until(page, obsSuggest, (w, a) => w.visible && w.focused && w.focused.order !== a.prev, { prev: f.order }, 3000, "the next suggestion"); }
      catch (e) { if (/timed out/.test(e.message)) break; throw e; }
    }
    return { position, total: Math.max(s.total, items.size), message: null, preselected, detailsPane: toggled ? "turned on for the walk, then off again" : s.showsDetails || (s.focused && s.focused.resolved) ? "already on" : "no item has details", items: [...items.values()].sort((x, y) => x.order - y.order) };
  } finally {
    if (opened) {
      if (toggled && (await observe(page, obsSuggest)).visible) {
        /* with the mode on, Ctrl+Space turns it off whatever item is focused */
        await page.keyboard.press("Control+Space");
        await until(page, obsSuggest, (w) => !w.visible || !w.showsDetails, null, 3000, "the details pane to collapse");
      }
      await page.keyboard.press("Escape");
      await until(page, obsSuggest, (w) => !w.visible, null, 3000, "the suggest list to close");
    }
    if (undo) {
      for (let k = 0; k < 5 && (await observe(page, obsLineText, { line: undo.line })) !== undo.text; k++) {
        await page.keyboard.press(MOD + "+z");
        await settle(page, obsLineText, { line: undo.line }, null, 3000, 3, "the undo");
      }
      if ((await observe(page, obsLineText, { line: undo.line })) !== undo.text) throw new Error("suggest: could not undo the typed text on line " + undo.line);
    }
  }
}

async function verbHoverText(page, o) {
  if (o.file) await actOpen(page, o.file);
  if (!o.line || !o.col) throw new Error("hovertext: which position? (lab hovertext <line>:<col>)");
  const position = where(await actGoto(page, o.line, o.col));
  await actRun(page, "Show or Focus Hover");
  try { await until(page, obsContentHover, (h) => h.visible && !h.loading, null, 5000, "the editor hover"); }
  catch (e) { if (/timed out/.test(e.message)) return { position, text: null, parts: [], actions: [], message: "no hover at this position" }; throw e; }
  /* providers may add parts after the first one: wait until the hover stops changing */
  const h = await settle(page, obsContentHover, null, (x) => x.visible && !x.loading, 5000, 6, "the editor hover");
  await page.keyboard.press("Escape");
  await until(page, obsContentHover, (x) => !x.visible, null, 3000, "the hover to close");
  return { position, text: h.text, parts: h.parts, actions: h.actions };
}

function tokenInfo(t) {
  /* the inspector draws tabs as "→", spaces as "·", and cuts tokens over 40 characters with "…" */
  const dec = (s) => (s || "").replace(/→/g, "\t").replace(/·/g, " ");
  const tm = t.rows["textmate token"] ? /^(.*) \((\d+)\)$/.exec(t.rows["textmate token"]) : null;
  const scopes = Array.isArray(t.rows["textmate scopes"]) ? t.rows["textmate scopes"].slice().reverse() : [];
  return { text: dec(t.text), length: t.length, truncated: (t.length || 0) > 40, language: t.rows.language || null, tokenType: t.rows["standard token type"] || null, scopes,
    semanticType: t.rows["semantic token type"] || null, modifiers: t.rows.modifiers || null, tmText: tm ? dec(tm[1]) : null, tmLength: tm ? Number(tm[2]) : null };
}

async function actCloseInspector(page) {
  if (!(await observe(page, obsTokenInspector)).visible) return;
  await page.keyboard.press("Escape");  /* the inspector closes on the Escape key-up in the editor */
  await until(page, obsTokenInspector, (t) => !t.visible, null, 3000, "the token inspector to close");
}

async function verbTokens(page, o) {
  if (o.file) await actOpen(page, o.file);
  if (!o.line) throw new Error("tokens: which line? (lab tokens <line>[:<col>])");
  const inspect = "Developer: Inspect Editor Tokens and Scopes";
  try {
    if (o.col) {
      const position = where(await actGoto(page, o.line, o.col));
      await actRun(page, inspect);
      const t = await until(page, obsTokenInspector, (x) => x.visible && (x.ready || /^No grammar/.test(x.message || "")), null, 5000, "the token inspector");
      if (!t.ready) return { position, text: null, length: null, scopes: [], message: t.message };
      return { position, ...tokenInfo(t) };
    }
    /* the whole line: from column 1, read the token, move the cursor by the TextMate token's length, repeat */
    await actGoto(page, o.line, 1);
    await page.keyboard.press("End");
    const end = await settle(page, obsCursor, null, (c) => c.line === o.line, 3000, 3, "the end of line " + o.line);
    const position = where(await actGoto(page, o.line, 1));
    const tokens = [];
    if (end.col > 1) {
      await actRun(page, inspect);
      /* col: the character column of the token; vcol: the status bar's (visible) column, which ends the walk at end.col */
      for (let col = 1, vcol = 1; vcol < end.col;) {
        const t = await until(page, obsTokenInspector, (x) => x.visible && (x.ready || /^No grammar/.test(x.message || "")), null, 5000, "the token inspector at column " + col);
        if (!t.ready) return { position, line: o.line, tokens, message: t.message };
        const info = tokenInfo(t);
        tokens.push({ col, ...info });
        const step = Math.max(1, info.tmLength || info.length || 1);
        for (let k = 0; k < step; k++) await page.keyboard.press("ArrowRight");
        await until(page, obsCursor, (c, a) => c.line !== a.line || c.col > a.v, { line: o.line, v: vcol }, 5000, "the cursor to move past column " + col);
        const c = await settle(page, obsCursor, null, null, 3000, 3, "the cursor after column " + col);
        if (c.line !== o.line) break;
        col += step;
        vcol = c.col;
      }
    }
    return { position, line: o.line, tokens };
  } finally {
    await actCloseInspector(page);
  }
}

async function verbMarkers(page, o) {
  if (o.file) await actOpen(page, o.file);
  const editor = (await observe(page, obsCursor)).editor;
  await actRun(page, "Focus on Problems View", true);
  const first = await settle(page, obsProblems, null, (p) => p.visible, 5000, 4, "the Problems view");
  const items = [];
  if (first.rows) {
    let file = null;
    const rows = await actWalk(page, obsProblems, (row) => row);
    for (const row of rows) {
      if (row.type === "resource") { file = { name: row.name, folder: row.folder }; continue; }
      if (row.type === "related") { if (items.length) items[items.length - 1].related.push({ file: row.file, start: row.start, message: row.message }); continue; }
      if (row.type !== "marker") continue;
      /* the accessible label holds the whole message even when the row shows only its first line */
      let message = row.shown;
      const suffix = row.start ? " at line " + row.start[0] + " and character " + row.start[1] + "." : null;
      const i = row.aria.indexOf(": "), j = suffix ? row.aria.lastIndexOf(suffix) : -1;
      if (i > 0 && j > i) message = row.aria.slice(i + 2, j);
      items.push({ file: file ? file.name : null, folder: file ? file.folder : null, severity: row.severity, message, source: row.source, code: row.code, codeHref: row.codeHref, range: { start: row.start, end: null }, related: [] });
    }
  }
  await actFocusEditor(page);
  /* the end of each range is where its squiggle ends on screen, for the problems of the active editor's file */
  const base = editor ? editor.split(",")[0].trim() : null;
  const sev = { error: "error", warning: "warning", info: "info" };
  for (const m of items) {
    if (!base || m.file !== base || !m.range.start || !sev[m.severity]) continue;
    const [line, col] = m.range.start;
    /* the Problems view counts characters, Go to Line/Column visible columns: go to the line, then right col-1 times */
    await actGoto(page, line, 1);
    for (let k = 1; k < col; k++) await page.keyboard.press("ArrowRight");
    let here = await settle(page, obsCursor, null, (x) => x.line === line, 3000, 3, "the cursor at the start of the problem");
    let g = await observe(page, obsSquiggles, { line });
    if (!g || !g.cursor) continue;
    const x0 = g.cursor.left;
    const sq = g.squiggles.filter((s) => s.severity === sev[m.severity]).find((s) => Math.abs(s.left - x0) < 2) || g.squiggles.find((s) => s.severity === sev[m.severity] && s.left <= x0 && x0 < s.right);
    if (!sq) continue;
    let c = col;
    for (let k = 0; k < 500; k++) {
      g = await observe(page, obsSquiggles, { line });
      if (g.cursor.left >= sq.right - 1) { m.range.end = [line, c]; break; }
      await page.keyboard.press("ArrowRight");
      here = await until(page, obsCursor, (x, a) => x.line !== a.line || x.col !== a.col, { line, col: here.col }, 2000, "the cursor to move right");
      if (here.line !== line) break;  /* the squiggle runs past the end of the line: a range over several lines */
      c += 1;
    }
    if (m.range.end && g.nextLine && g.nextLine.some((s) => s.severity === sev[m.severity] && s.left < 1)) { m.range.end = null; m.multiline = true; }
  }
  return { message: first.rows ? null : first.message, items };
}

async function verbFolds(page, o) {
  if (o.file) await actOpen(page, o.file);
  const back = await observe(page, obsCursor);
  const lines = await actLineCount(page);
  await actGoto(page, 1, 1);
  /* the state of each range is read when the cursor first lands on its first line: moving the cursor into a collapsed
     range later opens it */
  /* "Go to Next Folding Range" goes to the first range below the cursor's line, at any depth, except on a range's first
     line, where it goes to the next range at the same depth. So: on a first line, step down one line; elsewhere, use it. */
  const starts = [];
  let line = 1, state = (await observe(page, obsFold, { line: 1 })).state;
  if (state) starts.push({ line, state });
  for (let k = 0; k < 100000; k++) {
    if (state) {
      if (line >= lines) break;
      await page.keyboard.press("ArrowDown");
      const c = await until(page, obsCursor, (x, a) => x.line !== a.line, { line }, 3000, "the cursor to leave line " + line);
      if (c.line <= line) break;
      line = c.line;
    } else {
      await actRun(page, "Go to Next Folding Range");
      const c = await settle(page, obsCursor, null, (x) => !x.quickInput, 3000, 4, "the cursor after Go to Next Folding Range");
      if (c.line <= line) break;
      line = c.line;
    }
    state = (await observe(page, obsFold, { line })).state;
    if (state) starts.push({ line, state });
  }
  const items = [];
  for (const { line: start, state: found } of starts) {
    await actGoto(page, start, 1);
    const was = found === "collapsed" ? "collapsed" : "expanded";
    if ((await observe(page, obsFold, { line: start })).state !== "collapsed") {
      await actRun(page, "Fold");
      await until(page, obsFold, (f) => f.state === "collapsed", { line: start }, 3000, "line " + start + " to fold");
    }
    /* with the range folded, the line below the cursor is the first line after the range */
    await page.keyboard.press("ArrowDown");
    const below = await settle(page, obsCursor, null, null, 3000, 3, "the cursor below line " + start);
    items.push({ start, end: below.line > start ? below.line - 1 : lines, collapsed: was === "collapsed" });
    if (was !== "collapsed") {
      await actGoto(page, start, 1);
      await actRun(page, "Unfold");
      await until(page, obsFold, (f) => f.state === "expanded", { line: start }, 3000, "line " + start + " to unfold");
    }
  }
  /* ranges found collapsed have opened when the cursor visited lines inside them: fold them again, innermost first */
  for (const it of items.filter((x) => x.collapsed).sort((x, y) => y.start - x.start)) {
    await actGoto(page, it.start, 1);
    if ((await observe(page, obsFold, { line: it.start })).state !== "collapsed") {
      await actRun(page, "Fold");
      await until(page, obsFold, (f) => f.state === "collapsed", { line: it.start }, 3000, "line " + it.start + " to fold again");
    }
  }
  if (back.line) await actGoto(page, back.line, back.col);
  return { lines, items: items.sort((x, y) => x.start - y.start || y.end - x.end) };
}

async function verbOutline(page, o) {
  if (o.file) await actOpen(page, o.file);
  await actRun(page, "Focus on Outline View", true);
  const first = await until(page, obsOutline, (v) => v.visible && (v.rows > 0 || (!!v.message && !/^Loading/.test(v.message))), null, 10000, "the Outline view");
  let items = [];
  if (first.rows > 0) {
    const flat = await actWalk(page, obsOutline, (row) => row);
    const root = { children: [] }, stack = [{ level: 0, node: root }];
    for (const r of flat) {
      const node = { name: r.name, detail: r.detail, kind: r.kind, collapsed: r.expanded === "false", children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= r.level) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level: r.level, node });
    }
    items = root.children;
  }
  await actFocusEditor(page);
  return { message: first.rows > 0 ? null : first.message, items };
}

async function verbBreadcrumbs(page, o) {
  if (o.file) await actOpen(page, o.file);
  const position = where(o.line ? await actGoto(page, o.line, o.col) : await observe(page, obsCursor));
  /* the symbol part follows the cursor after a short delay: wait until the bar has not changed for 600 ms */
  const b = await settle(page, obsBreadcrumbs, null, (x) => x.visible, 8000, 12, "the breadcrumbs");
  return { position, items: b.items };
}

async function verbPanel(page) {
  return await observe(page, obsPanel);
}

/* kit #289, K6: the Settings editor as it settles; with tabs all, each tab's row ids too (an empty list when a tab lists
   none, null for a tab shown disabled, which can't be opened), clicking each tab and the first one again at the end */
async function verbSettingsEditor(page, o) {
  const read = () => settle(page, obsSettingsEditor, null, null, 10000, 4, "the Settings editor");
  const first = await read();
  if (!first.open) throw new Error("settings-editor: no Settings editor is open");
  const { disabled, ...out } = first;
  if (o.tabs !== "all") return out;
  const tab = (label) => page.locator(".settings-editor .settings-tabs-widget .action-item").filter({ hasText: label }).first();
  out.by_tab = {};
  for (const label of first.tabs) {
    if (disabled.includes(label)) { out.by_tab[label] = null; continue; }
    if (label !== first.tab) await tab(label).click({ timeout: 5000 });
    out.by_tab[label] = (await read()).rows.map((r) => r.id);
  }
  if (first.tab) { await tab(first.tab).click({ timeout: 5000 }); await read(); }
  return out;
}

/* kit #289, K6: the open Settings editor's search box gets `query` in place of what it held; the rows then settle */
async function verbSettingsSearch(page, query) {
  const box = page.locator(".settings-editor .settings-header .monaco-editor").first();
  if (!(await box.count()) || !(await box.isVisible())) throw new Error("settings-search: no Settings editor is open");
  await box.click({ timeout: 5000 });
  await page.keyboard.press("Control+a");
  if (query) await page.keyboard.type(query);
  else await page.keyboard.press("Delete");
  /* the editor filters after a short pause in typing: the old rows stay a while, so the rows count once they have held
     for 600 ms after that pause */
  await page.waitForTimeout(400);
  const r = await settle(page, obsSettingsEditor, null, null, 10000, 12, "the Settings editor's rows");
  return { query, rows: r.rows.length };
}

/* kit #289, K6: select all of the text or number box of the shown row whose setting id is o.id and type o.value; Enter is
   never pressed and the box keeps the focus, so the editor's validation shows under it */
async function verbSettingInput(page, o) {
  if (typeof o.id !== "string" || typeof o.value !== "string") throw new Error("setting-input: wants {\"id\": <setting id>, \"value\": <text>}");
  const row = page.locator(`.settings-editor .settings-tree-container .setting-item-contents[data-key="${o.id.replace(/["\\]/g, "\\$&")}"]`);
  if (!(await row.count()) || !(await row.first().isVisible())) throw new Error("setting-input: no shown row for " + o.id);
  const box = row.first().locator(".setting-item-control input.input, .setting-item-control textarea");
  if (!(await box.count())) throw new Error("setting-input: the row for " + o.id + " has no text or number box");
  await box.first().click({ timeout: 5000 });
  await page.keyboard.press("Control+a");
  await page.keyboard.type(o.value);
  await frames(page);
  await page.waitForTimeout(500);
  return { id: o.id, typed: o.value.length };
}

const EDITOR_VERBS = { panel: verbPanel, open: verbOpen, goto: verbGoto, suggest: verbSuggest, hovertext: verbHoverText, markers: verbMarkers, tokens: verbTokens, folds: verbFolds, outline: verbOutline, breadcrumbs: verbBreadcrumbs };

/* the text form of an editor verb's payload */
function editorText(verb, r) {
  const at = (p) => (p && p.line ? "Ln " + p.line + ", Col " + p.col : "?");
  const q = (s) => JSON.stringify(s);
  const block = (s, pad) => String(s).split("\n").map((l) => pad + "| " + l).join("\n");
  const out = [];
  if (verb === "open" || verb === "goto") out.push((verb === "open" ? "OPENED: " + (r.path || r.editor || "?") + "   " : "") + "CURSOR: " + at(r.position));
  if (verb === "suggest") {
    out.push("SUGGEST at " + at(r.position) + ": " + r.total + " item(s)" + (r.message ? ", message: " + r.message : "") + (r.preselected !== null ? ", preselected: #" + r.preselected : "") + (r.detailsPane ? "; details pane " + r.detailsPane : ""));
    for (const it of r.items) {
      out.push("  #" + it.order + (it.preselected ? "*" : "") + " " + (it.kind ? "(" + it.kind + ") " : "") + q(it.label) + (it.labelDetail ? " labelDetail=" + q(it.labelDetail) : "") + (it.qualifier ? " qualifier=" + q(it.qualifier) : "") + (it.description ? " desc=" + q(it.description) : "") + (it.deprecated ? " [deprecated]" : ""));
      if (it.detail) out.push("      detail: " + it.detail.replace(/\n/g, "\n              "));
      if (it.documentation) out.push("      docs:\n" + block(it.documentation, "        "));
      for (const l of it.links || []) out.push("      link: " + l.text + " -> " + l.href);
    }
  }
  if (verb === "hovertext") {
    if (!r.text) out.push("NO HOVER at " + at(r.position));
    else {
      out.push("HOVER at " + at(r.position) + ":");
      for (const p of r.parts) { out.push("  [" + p.kind + "]"); out.push(block(p.text, "    ")); for (const l of p.links) out.push("    link: " + l.text + " -> " + l.href); }
      if (r.actions.length) out.push("  actions: " + r.actions.join(" | "));
    }
  }
  if (verb === "markers") {
    out.push("PROBLEMS (" + r.items.length + ")" + (r.message ? ": " + r.message : ""));
    for (const m of r.items) {
      const s = m.range.start, e = m.range.end;
      out.push("  - [" + m.severity + "] " + (m.file || "?") + " " + (s ? s[0] + ":" + s[1] : "?") + (e ? "-" + e[0] + ":" + e[1] : m.multiline ? "-(next lines)" : "") + "  " + q(m.message) + (m.source ? "  source=" + q(m.source) : "") + (m.code ? "  code=" + q(m.code) + (m.codeHref ? " -> " + m.codeHref : "") : ""));
      for (const rel of m.related) out.push("      related: " + rel.file + " " + (rel.start ? rel.start.join(":") : "") + " " + q(rel.message));
    }
  }
  if (verb === "tokens") {
    const one = (t) => q(t.text) + " (" + t.length + " char" + (t.length === 1 ? "" : "s") + (t.truncated ? ", shown cut" : "") + ")  " + t.scopes.join(" > ") + (t.semanticType ? "  semantic=" + t.semanticType + (t.modifiers ? " [" + t.modifiers + "]" : "") : "");
    if (r.tokens) { out.push("TOKENS of line " + r.line + " (scopes outermost > innermost):"); for (const t of r.tokens) out.push("  col " + t.col + "  " + one(t)); }
    else out.push("TOKEN at " + at(r.position) + " language=" + r.language + " type=" + r.tokenType + " (scopes outermost > innermost):\n  " + one(r));
  }
  if (verb === "folds") out.push("FOLDS (" + r.items.length + ", file has " + r.lines + " lines): " + (r.items.map((f) => f.start + "-" + f.end + (f.collapsed ? " (collapsed)" : "")).join(", ") || "none"));
  if (verb === "outline") {
    out.push("OUTLINE" + (r.message ? ": " + r.message : ""));
    const walk = (ns, d) => { for (const n of ns) { out.push("  ".repeat(d + 1) + "- " + (n.kind ? "(" + n.kind + ") " : "") + q(n.name) + (n.detail ? " detail=" + q(n.detail) : "") + (n.collapsed ? " [collapsed]" : "")); walk(n.children, d + 1); } };
    walk(r.items, 0);
  }
  if (verb === "panel") {
    if (!r.visible) out.push("PANEL: hidden");
    else {
      out.push("PANEL: shown" + (r.position ? " (" + r.position + ")" : "") + (r.maximized ? ", maximized" : "") + (r.focused ? ", has keyboard focus" : "") + "; in front: " + (r.front || "?"));
      out.push("  tabs: " + r.tabs.map((t) => (t.active ? "*" : "") + t.label + (t.badge ? " [" + t.badge + "]" : "")).join(" | "));
      if (r.terminals) out.push("  terminals: " + r.terminals.map((t) => (t.active ? "*" : "") + q(t.name)).join(" | ") + (r.terminalFocused ? "   (the terminal has keyboard focus)" : ""));
      if (r.outputChannel) out.push("  output channel: " + q(r.outputChannel));
      out.push("  visible text: " + (r.visibleLines === null ? "unknown (the terminal draws its text on a canvas)" : r.visibleLines + " non-empty line(s)"));
    }
  }
  if (verb === "breadcrumbs") out.push("BREADCRUMBS at " + at(r.position) + ": " + (r.items.map((b) => b.name + (b.kind ? " (" + b.kind + ")" : "")).join(" > ") || "(none)"));
  return out.join("\n");
}

/* R-63 (D-44, D-45): a window may only have opened the room's workspaces on each remote authority. LAB_REMOTE_POLICY
   ({"strict", "rules": {authority glob: [absolute prefix]}}, exported by the `lab` wrapper from [lab] remote_workspaces
   and tunnel_workspaces; kitlib.remote_allowed is the same rule) or the older LAB_TUNNEL_PREFIXES (':'-separated, tunnels
   only); neither = no check. VS Code records every folder a window of this slot opened in its workspaceStorage at once;
   one outside the room's workspaces closes the slot's windows. */
function r63Policy() {
  if (process.env.LAB_REMOTE_POLICY) return JSON.parse(process.env.LAB_REMOTE_POLICY);
  if (process.env.LAB_TUNNEL_PREFIXES) return { strict: false, rules: { "tunnel+*": process.env.LAB_TUNNEL_PREFIXES.split(":").filter(Boolean) } };
  return null;
}
function r63Authority(a) {
  a = decodeURIComponent(a);
  const i = a.indexOf("+");
  if (i < 0) return a;
  let rest = a.slice(i + 1);
  if (rest.length % 2 === 0 && /^7b[0-9a-f]+$/i.test(rest)) {
    try { rest = String(JSON.parse(Buffer.from(rest, "hex").toString("utf8")).hostName); } catch (e) { /* keep it */ }
  }
  return a.slice(0, i) + "+" + rest;
}
function r63Path(p) {
  p = path.posix.normalize(decodeURIComponent(p || "/") || "/");
  if (p.startsWith("//")) p = "/" + p.replace(/^\/+/, "");
  return p.replace(/^\/([A-Za-z]):/, (m, d) => "/" + d.toLowerCase() + ":");
}
function r63Glob(g) {
  return new RegExp("^" + g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}
function r63Allowed(pol, authority, p) {
  const auth = r63Authority(authority);
  const pre = Object.entries(pol.rules).filter(([g]) => r63Glob(g).test(auth)).flatMap(([, v]) => v);
  if (!Object.keys(pol.rules).some((g) => r63Glob(g).test(auth))) return !(pol.strict || auth.startsWith("tunnel+"));
  const q = r63Path(p);
  return pre.some((x) => { x = r63Path(x).replace(/\/+$/, ""); return q === x || q.startsWith(x + "/") || x === ""; });
}
function r63Violation() {
  const pol = r63Policy();
  if (!pol) return null;
  const dir = LAB + "/user-data/User/workspaceStorage";
  let ents = [];
  try { ents = fs.readdirSync(dir); } catch (e) { return null; }
  for (const e of ents) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, e, "workspace.json"), "utf8")); } catch (err) { continue; }
    const u = String(j.folder || j.workspace || "");
    const m = /^vscode-remote:\/\/([^/]+)(\/.*)?$/i.exec(u);
    if (!m) continue;
    if (!r63Allowed(pol, m[1], m[2])) return u;
  }
  return null;
}
async function r63Enforce() {
  const u = r63Violation();
  if (!u) return;
  console.error("VIOLATION (R-63, D-44, D-45): a window of slot " + SLOT + " opened " + u + ", outside the room's " +
    "workspaces for that remote. This slot's windows are being closed. Record nothing from it, reset the slot (lab-code reset) and report it.");
  try {
    const { execFileSync } = await import("child_process");
    execFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "lab-code"), ["stop"], { stdio: "ignore", env: process.env });
  } catch (e) { console.error("lab: could not stop slot " + SLOT + ": " + e.message.split("\n")[0]); }
  process.exit(3);
}
async function main() {
  await r63Enforce();
  const [sub, ...args] = process.argv.slice(2);
  if (sub === "paths" && (process.env.DOCKER_HOST || process.env.LAB_HOME)) {
    console.log("isolation: " + (process.env.DOCKER_HOST ? "private Docker daemon " + process.env.DOCKER_HOST + " (the docker command in your shell already uses it; other runs cannot see its containers)\n" : "")
      + (process.env.LAB_HOME ? "the lab VS Code runs with HOME=" + process.env.LAB_HOME + " (its ~/.gitconfig, ~/.ssh, ~/.gnupg, ~/.docker, ~/.config/gh are there)\n" : ""));
  }
  if (sub === "urls") {  // links VS Code tried to open in a browser (captured by the lab's xdg-open shim)
    const f = LAB + "/opened-urls.log";
    const text = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trimEnd() : "";
    /* LAB_JSON (kit #227 item 2): {ok, urls: [...]}, in the order they were opened, each without the shim's timestamp
       (the first two words of its line), so two runs compare; the text output is unchanged */
    if (JSON_MODE) {
      console.log(JSON.stringify({ok: true, urls: text ? text.split("\n").map((l) => l.split(" ").slice(2).join(" ")) : []}));
      return;
    }
    console.log(text || "(none)");
    return;
  }
  if (!sub || sub === "help") { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").filter((l) => l.startsWith("//")).join("\n")); return; }
  if (sub === "paths") {
    console.log("slot: " + SLOT + "\nCDP port: " + PORT + "\nprofile (user data): " + LAB + "/user-data\nsettings: " + LAB + "/user-data/User/settings.json\nglobal state db: " + LAB + "/user-data/User/globalStorage/state.vscdb\nworkspace state dbs: " + LAB + "/user-data/User/workspaceStorage/<id>/state.vscdb (workspace.json in each folder names the workspace)\nextension global storage: " + LAB + "/user-data/User/globalStorage/" + (EXT_IDS[0] || "<extension id>") + "/\nlogs: " + LAB + "/user-data/logs/<session>/window<N>/exthost/" + (EXT_IDS[0] || "<extension id>") + "/\nread .vscdb files with python3 (module sqlite3); there is no sqlite3 command");
    return;
  }
  if (sub === "logs-all") {
    const base = LAB + "/user-data/logs";
    const all = [];
    const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".log")) all.push(p); } };
    walk(base);
    const kind = (p) => EXT_IDS.some((id) => p.includes(id)) ? "EXTENSION (Dev Containers)" : /renderer\.log$/.test(p) ? "VS Code core: window (renderer, remote resolution)" : /exthost\.log$/.test(p) ? "VS Code core: extension host" : /(main|sharedprocess|ptyhost)\.log$/.test(p) ? "VS Code core: " + path.basename(p, ".log") : "other: " + path.basename(p);
    const newest = all.map((p) => ({ p, t: fs.statSync(p).mtimeMs, n: fs.statSync(p).size })).sort((a, b) => b.t - a.t);
    for (const f of newest.slice(0, 25)) console.log(new Date(f.t).toISOString().slice(11, 19) + "  " + String(f.n).padStart(8) + "  " + kind(f.p).padEnd(52) + "  " + f.p);
    console.log("VS Code server logs inside a container: <home of the remote user>/.vscode-server/data/logs/ (docker exec ... ls / tail the *.log files only)");
    return;
  }
  if (sub === "log" || sub === "logs") {
    const ci = args.indexOf("--channel");
    const channel = ci >= 0 ? args[ci + 1] : null;
    if (ci >= 0) args.splice(ci, 2);
    const logs = newestLogs(channel);
    if (!logs.length) {
      console.log(channel ? "no log file of the output channel \"" + channel + "\" yet"
        : process.env.LAB_LOG_CHANNELS ? "no log files of this room's extension or output channels (" + process.env.LAB_LOG_CHANNELS.split("\n").join(", ") + ") yet"
        : "no Dev Containers log files yet");
      return;
    }
    if (sub === "logs") { for (const l of logs) console.log(new Date(l.t).toISOString(), l.p); return; }
    const n = parseInt(args[0] || "80", 10);
    const lines = fs.readFileSync(logs[0].p, "utf8").split("\n");
    console.log("== " + logs[0].p + " (" + lines.length + " lines, showing last " + n + ")");
    console.log(lines.slice(-n).join("\n"));
    return;
  }
  /* an editor verb's arguments are checked before any window is touched */
  const editorOpts = EDITOR_VERBS[sub] ? editorArgs(sub, args) : null;
  if (PUBLISH_ACTIVATIONS.has(sub) && PUBLISH_RE.test(args.join(" "))) {
    if (JSON_MODE) console.log(JSON.stringify({ command: sub, args, ok: false, error: PUBLISH_MSG }));
    else console.log(PUBLISH_MSG + ": " + args.join(" "));
    process.exitCode = 1;
    return;
  }
  if (sub === "notification-log-keep") {
    /* athena on kit #241 (A): stays attached for the window's life (CDP init scripts end with the session that set them),
       so every page, a reload or a new window included, has the notification log from its first moment. The provisioner
       starts it with the window and stops it with the window; it also ends when the window closes. Holds no page data. */
    const until = Date.now() + 120000;
    let browser;
    for (;;) {
      try { browser = await chromium.connectOverCDP("http://127.0.0.1:" + PORT, { timeout: 15000 }); break; }
      catch (e) { if (Date.now() > until) { console.log(JSON.stringify({ ok: false, error: "no window to keep a log for: " + e.message })); process.exitCode = 1; return; } }
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const c of browser.contexts()) await c.addInitScript(installNotificationLog);
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.evaluate(installNotificationLog).catch(() => {});
    console.log(JSON.stringify({ ok: true, keeping: true }));
    await new Promise((r) => browser.on("disconnected", r));
    return;
  }
  const { browser, page, pages, all } = await connect();
  await armPublishBarrier(all);
  if (JSON_MODE) RESULT = { command: sub, args, ok: true };
  try {
    switch (sub) {
      case "windows":
        if (JSON_MODE) {
          const ws = [];
          /* opened (kit #227 item 8): the editor's own window id (globalThis.vscodeWindowId, the main process's BrowserWindow
             id, given in the order windows open), so two same-title windows are told apart however the list orders them */
          for (const [i, p] of all.entries()) ws.push({ index: i, title: await p.title(), current: p === page, auxiliary: !p.url().includes("workbench"),
            opened: await p.evaluate(() => globalThis.vscodeWindowId ?? null).catch(() => null) });
          RESULT = { windows: ws };
          break;
        }
        for (const [i, p] of all.entries()) console.log("#" + i + " " + (await p.title()) + (p === page ? "   [current]" : "") + (p.url().includes("workbench") ? "" : "   [auxiliary window]"));
        console.log("(select one with LAB_WINDOW=#<n> or LAB_WINDOW=<title substring>)");
        break;
      case "notifications-seen":
        await page.evaluate(installNotificationLog);
        RESULT = await page.evaluate(() => { const l = globalThis.__labNotificationLog; return { epoch: l.epoch, seen: [...l.seen] }; });
        if (!JSON_MODE) for (const e of RESULT.seen) console.log(e.seq + " " + e.text);
        break;
      case "state":
        if (JSON_MODE) { RESULT = await snapshotData(page); break; }
        await printState(page, 0);
        break;
      case "watch": {
        // Poll the screen state every 1.5 s for N seconds; print a new block only when something changed.
        const secs = parseFloat(args[0] || "60");
        const until = performance.now() + secs * 1000;
        let last = "", slept0 = hostSlept();
        const t0 = performance.now();
        while (performance.now() < until) {
          let cur;
          try {
            const { browser: b2, page: p2 } = await connect();
            cur = await snapshotState(p2);
            await b2.close().catch(() => {});
          } catch (e) { cur = "(window not reachable: " + e.message.split("\n")[0] + ")"; }
          const sl = hostSlept();
          if (sl !== slept0) { console.log("---- HOST SLEEP of about " + (sl - slept0) + " s before this point: timings across it are invalid"); slept0 = sl; last = ""; }
          if (cur !== last) { console.log("---- t+" + ((performance.now() - t0) / 1000).toFixed(1) + "s"); console.log(cur); last = cur; }
          await sleep(1500);
        }
        break;
      }
      case "items": {
        // Enumerate ALL items of the open quick input (the list is virtualized) by walking it with ArrowDown.
        const max = parseInt(args[0] || "400", 10);
        const input = page.locator(".quick-input-widget .quick-input-box input");
        if (!(await input.isVisible())) { if (JSON_MODE) RESULT = { open: false, items: [] }; else console.log("no quick input is open"); break; }
        const read = () => page.evaluate(() => {
          const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
          const r = document.querySelector(".quick-input-widget .quick-input-list .monaco-list-row.focused");
          if (!r) return null;
          const label = r.querySelector(".label-name") || r.querySelector(".monaco-icon-label");
          const desc = r.querySelector(".label-description");
          const detail = r.querySelector(".quick-input-list-detail, .quick-input-list-row-detail");
          let sep = r.querySelector(".quick-input-list-separator");
          if (sep && (sep.offsetParent === null || getComputedStyle(sep).display === "none" || !r.classList.contains("quick-input-list-separator-border") && !(r.querySelector(".quick-input-list-separator-as-item")) && getComputedStyle(sep).visibility === "hidden")) sep = null;
          const cb = r.querySelector("input[type=checkbox]");
          const icons = [...r.querySelectorAll(".codicon")].filter((i) => !i.closest(".quick-input-list-entry-action-bar")).map((i) => [...i.classList].find((c) => c.startsWith("codicon-") && c !== "codicon-modifier-spin")).filter(Boolean);
          return { id: r.id + "|" + r.getAttribute("data-index"), label: norm(label ? label.textContent : r.getAttribute("aria-label")), desc: norm(desc && desc.textContent), detail: norm(detail && detail.textContent), sep: norm(sep && sep.textContent), checked: cb ? cb.checked : null, icons };
        });
        let snap0 = null;
        if (JSON_MODE) {
          snap0 = await page.evaluate(renderedQuickPickRows);
          if (snap0.complete && !process.env.LAB_ITEMS_WALK) {
            /* the whole list is rendered: read it in place, so observing it moves nothing (F-0419-AC1-5) */
            const rows = snap0.rows.filter((r) => r.selectable || snap0.rows.every((x) => !x.selectable));
            RESULT = { open: true, read: "rendered", items: rows.map((it) => ({ label: it.label, description: it.desc || null, detail: it.detail || null, separator: it.sep || null, checked: it.checked, icons: it.icons })) };
            await input.focus().catch(() => {});
            break;
          }
        }
        const seen = new Set();
        const out = [];
        let first = await read();
        if (!first) { await page.keyboard.press("ArrowDown"); await sleep(100); first = await read(); }
        let cur = first;
        for (let i = 0; i < max && cur; i++) {
          const key = cur.id + cur.label;
          if (seen.has(key)) break;
          seen.add(key);
          out.push(cur);
          await page.keyboard.press("ArrowDown");
          await sleep(60);
          cur = await read();
        }
        if (JSON_MODE) RESULT = { open: true, read: "walk", items: out.map((it) => ({ label: it.label, description: it.desc || null, detail: it.detail || null, separator: it.sep || null, checked: it.checked, icons: it.icons })) };
        if (JSON_MODE) {
          /* put the active row back where it was before the walk (the walk moves it), and the focus in the input box */
          const want = snap0 ? snap0.active : null;
          const activeIndex = () => page.evaluate(() => { const r = document.querySelector(".quick-input-widget .quick-input-list .monaco-list-row.focused"); return r ? Number(r.getAttribute("data-index")) : null; });
          let restored = want === null ? false : null;
          if (want !== null) for (let k = 0; k <= out.length + 2; k++) { if ((await activeIndex()) === want) { restored = true; break; } await page.keyboard.press("ArrowDown"); await sleep(60); }
          RESULT.activeRestored = restored === true ? true : want === null ? "no row was active before; one is now" : false;
          await input.focus().catch(() => {});
          break;
        }
        else console.log("ALL ITEMS (" + out.length + "):");
        if (!JSON_MODE) out.forEach((it, i) => console.log("  " + (i + 1) + ". " + (it.sep ? "[separator " + JSON.stringify(it.sep) + "] " : "") + (it.checked === null ? "" : it.checked ? "[x] " : "[ ] ") + (it.icons.length ? "(" + it.icons.join(",") + ") " : "") + JSON.stringify(it.label) + (it.desc ? "  desc=" + JSON.stringify(it.desc) : "") + (it.detail ? "  detail=" + JSON.stringify(it.detail) : "")));
        // return focus to the first item
        for (let i = 0; i < out.length - 1 && out.length < max; i++) { }
        await page.keyboard.press("Home").catch(() => {});
        break;
      }
      case "wait":
        await printState(page, parseFloat(args[0] || "3") * 1000);
        break;
      case "palette": {
        await openPalette(page, args.join(" "));
        await printState(page, 300);
        break;
      }
      case "cmd": {
        const want = args.join(" ");
        await openPalette(page, want);
        const rows = await qiRows(page);
        // LAB_CMD_EXACT=1: the title alone, no aria-prefix fallback (the encode step `window: {close}` runs the editor
        // core's "Close Window" this way, never an extension's command; extension commands show their category first)
        const hit = rows.find((r) => r.label === want || (!process.env.LAB_CMD_EXACT && r.aria.startsWith(want)));
        if (!hit) { fail("COMMAND NOT FOUND (exact title). Visible items:\n" + rows.map((r) => "  - " + r.label).join("\n")); await page.keyboard.press("Escape"); break; }
        await clickRow(page, hit.label);
        say("ran: " + want);
        await printState(page, 2000);
        break;
      }
      case "pick": {
        const got = await clickRow(page, args.join(" "));
        if (!got) { fail("ITEM NOT FOUND: " + args.join(" ")); await printState(page, 0); break; }
        if (JSON_MODE) RESULT.picked = got;
        say("picked: " + got + (got === args.join(" ") ? "" : "   (NOTE: not an exact match for \"" + args.join(" ") + "\")"));
        await printState(page, 1500);
        break;
      }
      case "check": {
        const want = args.join(" ");
        const rows = await qiRows(page);
        const hit = rows.find((r) => r.label === want) || rows.find((r) => r.label.startsWith(want));
        if (!hit) { fail("ITEM NOT FOUND: " + want); break; }
        const els = [];
        for (const e of await page.$$(".quick-input-widget .quick-input-list .monaco-list-row")) if (await e.isVisible()) els.push(e);
        const cb = await els[hit.i].$("input[type=checkbox], .quick-input-list-checkbox");
        await (cb || els[hit.i]).click();
        await printState(page, 500);
        break;
      }
      case "type": {
        // `lab type --stdin`: the text from stdin, never the command line (a case's secret, athena on kit #209: a value in
        // argv is readable from /proc/<pid>/cmdline while the process runs); a trailing newline is not part of it
        const text = args[0] === "--stdin" ? fs.readFileSync(0, "utf8").replace(/\n$/, "") : args.join(" ");
        const input = page.locator(".quick-input-widget .quick-input-box input");
        if (await input.isVisible()) await input.fill(text);
        else { const d = page.locator(".monaco-dialog-box input:not([type=checkbox])"); if (await d.count()) await d.first().fill(text); else { fail("NOTHING TO TYPE INTO: no quick input or dialog input is open (use `lab typeraw` to type into the focused editor or terminal)"); } }
        await printState(page, 1200);
        break;
      }
      case "typeraw":
        await page.keyboard.type(args.join(" "));
        await printState(page, 800);
        break;
      case "paths":
        console.log("slot: " + SLOT + "\nCDP port: " + PORT + "\nprofile (user data): " + LAB + "/user-data\nsettings: " + LAB + "/user-data/User/settings.json\nglobal state db: " + LAB + "/user-data/User/globalStorage/state.vscdb\nworkspace state dbs: " + LAB + "/user-data/User/workspaceStorage/<id>/state.vscdb (workspace.json in each folder names the workspace)\nextension global storage: " + LAB + "/user-data/User/globalStorage/" + (EXT_IDS[0] || "<extension id>") + "/\nlogs: " + LAB + "/user-data/logs/<session>/window<N>/exthost/" + (EXT_IDS[0] || "<extension id>") + "/\nread .vscdb files with python3 (module sqlite3); there is no sqlite3 command");
        break;
      case "key":
        // "Mod+" = the platform's command modifier: Meta (Cmd) on macOS, Control elsewhere
        await page.keyboard.press(args[0].replace(/\bMod\+/g, process.platform === "darwin" ? "Meta+" : "Control+"));
        await printState(page, 1500);
        break;
      case "button": {
        const want = args.join(" ");
        if (want === "--dialog-close") {   // kit #227 item 1: the modal dialog's own close X (aria "Close Dialog")
          const x = page.locator(".monaco-dialog-box .dialog-toolbar-row .action-label.codicon-dialog-close").first();
          if (!(await x.count()) || !(await x.isVisible())) { fail("no dialog with a close X is shown"); break; }
          await x.click();
          say("closed the dialog by its X");
          break;
        }
        const sel = [".monaco-dialog-box .dialog-buttons .monaco-button", ".notifications-toasts .notification-list-item-buttons-container .monaco-button", ".notifications-center .notification-list-item-buttons-container .monaco-button", ".quick-input-widget .monaco-button", ".quick-input-widget .action-label"];
        let done = false;
        for (const s of sel) {
          for (const b of await page.$$(s)) {
            if (!(await b.isVisible())) continue;
            const t = ((await b.textContent()) || "").replace(/\s+/g, " ").trim();
            const a = (await b.getAttribute("aria-label")) || "";
            if (t === want || a === want) { await b.click(); done = true; break; }
          }
          if (done) break;
        }
        if (!done && await page.locator(".quick-input-widget").first().isVisible().catch(() => false)) {
          /* the quick input's buttons by accessible name (icon-only title-bar buttons such as Back) */
          const b = page.locator(".quick-input-widget").first().getByRole("button", { name: nameRe(want) }).first();
          if (await b.count()) {
            try { await b.click({ timeout: 5000 }); done = true; say("(quick input button by accessible name)"); } catch (e) { /* fall through */ }
          }
        }
        if (!done) {
          // Toasts hide after a while; look in the notification center too.
          await openPalette(page, "Notifications: Show Notifications");
          await page.keyboard.press("Enter");
          await sleep(800);
          for (const b of await page.$$(".notifications-center .notification-list-item-buttons-container .monaco-button")) {
            if (!(await b.isVisible())) continue;
            const t = ((await b.textContent()) || "").replace(/\s+/g, " ").trim();
            if (t === want) { await b.click(); done = true; say("(found in the notification center)"); break; }
          }
          if (!done) await page.keyboard.press("Escape");
        }
        if (!done && await clickViewAction(page, null, want)) { done = true; say("(view title action by accessible name)"); }
        if (done) say("clicked: " + want); else fail("BUTTON NOT FOUND: " + want);
        await printState(page, 1500);
        break;
      }
      case "link": {
        const want = args.join(" ");
        const l = page.locator("a", { hasText: want }).filter({ visible: true }).first();
        if (await l.count()) { await l.click(); say("clicked link: " + want); } else fail("LINK NOT FOUND: " + want);
        await printState(page, 1500);
        break;
      }
      case "remote": {
        const r = page.locator("#status\\.host, .statusbar-item.remote-kind, [id='status.host']").first();
        if (await r.count()) await r.click(); else fail("remote indicator not found");
        await printState(page, 1000);
        break;
      }
      case "view": {
        const res = await treeRows(page, args.join(" "));
        if (res.error) { fail(res.error); break; }
        if (JSON_MODE) {
          const tri = (v) => (v === "true" ? true : v === "false" ? false : null);
          RESULT = {
            view: args.join(" "), expanded: res.expanded === "true", titleActions: res.titleActions,
            welcome: res.welcome.filter((w) => !w.startsWith("(view message) ")), welcomeLinks: res.welcomeLinks, messages: res.welcome.filter((w) => w.startsWith("(view message) ")).map((w) => w.slice(15)),
            rows: res.rows.map((r) => ({ depth: Math.max(1, Number(r.level) || 1), label: r.label, description: r.desc || null, expanded: tri(r.expanded), icon: r.icon || null, tooltip: r.title || null, actions: r.actions, aria: r.aria || null })),
          };
          break;
        }
        console.log("VIEW " + args.join(" ") + " (header " + (res.expanded === "true" ? "expanded" : "collapsed") + ")  title actions: " + JSON.stringify(res.titleActions));
        for (const w of res.welcome) console.log("WELCOME: " + w);
        for (const r of res.rows) console.log("  ".repeat(Math.max(0, (r.level || 1) - 1)) + "- " + JSON.stringify(r.label) + (r.desc ? " desc=" + JSON.stringify(r.desc) : "") + (r.expanded ? " expanded=" + r.expanded : "") + (r.icon ? " icon=" + r.icon : "") + (r.title ? " tooltip=" + JSON.stringify(r.title.slice(0, 200)) : "") + (r.actions.length ? " inline=" + JSON.stringify(r.actions) : ""));
        break;
      }
      case "hover": {
        // lab hover "<view>" "<row>": rest the mouse on a tree row and print the hover (rich tooltip) it opens
        const [view, row] = args;
        const pane = page.locator(".pane").filter({ has: page.locator(".pane-header h3", { hasText: view }) }).first();
        const r = rowLocator(pane, row);
        if (!(await r.count())) { fail("ROW NOT FOUND: " + row); break; }
        await r.locator(".monaco-icon-label, .label-name, .monaco-highlighted-label").first().hover().catch(() => r.hover());
        await page.waitForTimeout(1800);
        const texts = await page.evaluate(() => [...document.querySelectorAll(".workbench-hover, .monaco-hover")]
          .filter((h) => h.offsetParent !== null || h.getClientRects().length)
          .map((h) => h.innerText.trim()).filter(Boolean));
        if (JSON_MODE) RESULT.hovers = texts;
        if (!texts.length) say("NO HOVER (the row may only have a plain tooltip: see `lab view`, tooltip=...)");
        for (const t of texts) say("HOVER:\n" + t);
        await page.mouse.move(0, 0);
        break;
      }
      case "rowmenu":
      case "rowaction": {
        const [view, row, action] = args;
        const pane = page.locator(".pane").filter({ has: page.locator(".pane-header h3", { hasText: view }) }).first();
        const r = rowLocator(pane, row);
        if (!(await r.count())) { fail("ROW NOT FOUND: " + row); break; }
        if (sub === "rowmenu") { await r.click({ button: "right" }); }
        else {
          await r.hover();
          const a = r.locator(".actions .action-label[aria-label='" + action.replace(/'/g, "\\'") + "']");
          if (await a.count()) await a.click();
          else {
            /* by accessible name (a label with a keybinding, another element), hidden until the row is hovered */
            const b = r.getByRole("button", { name: nameRe(action), includeHidden: true }).first();
            if (await b.count()) { await r.hover(); await b.click({ timeout: 5000 }); say("(row action by accessible name)"); }
            else fail("ACTION NOT FOUND: " + action);
          }
        }
        await printState(page, 1200);
        break;
      }
      case "viewaction": {
        const [view, action] = args;
        if (await clickViewAction(page, view, action)) say("clicked view action: " + action + " (" + view + ")");
        else fail("VIEW ACTION NOT FOUND: " + action + " in " + view);
        await printState(page, 1200);
        break;
      }
      case "menu": {
        const want = args.join(" ");
        /* the menu may still be opening: wait (bounded) for its first item, then prefer the one item whose accessible
           name is exactly <want>; otherwise the first label containing <want>, as before */
        await page.locator(".monaco-menu .action-item").first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
        const exact = page.locator(".monaco-menu").getByRole("menuitem", { name: nameRe(want) });
        const it = page.locator(".monaco-menu .action-item .action-label").filter({ hasText: want }).first();
        if ((await exact.count()) === 1) { await exact.first().click({ timeout: 5000 }); say("clicked menu: " + want); if (RESULT) RESULT.menuBy = "accessible name"; }
        else if (await it.count()) { await it.click(); say("clicked menu: " + want); } else fail("MENU ITEM NOT FOUND: " + want);
        await printState(page, 1500);
        break;
      }
      case "focus": {
        await openPalette(page, "View: Focus on " + args.join(" "));
        await page.keyboard.press("Enter");
        await printState(page, 1200);
        break;
      }
      case "notifications": {
        await openPalette(page, "Notifications: Show Notifications");
        await page.keyboard.press("Enter");
        await sleep(800);
        if (JSON_MODE) {
          RESULT = { notifications: await page.evaluate(() => [...document.querySelectorAll(".notifications-center .notification-list-item")].map((n) => {
            const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
            const m = n.querySelector(".notification-list-item-message"), s = n.querySelector(".notification-list-item-source"), sev = n.querySelector(".notification-list-item-icon");
            return { severity: sev ? ([...sev.classList].find((c) => /codicon-(info|warning|error)/.test(c)) || "").replace("codicon-", "") : null, text: norm(m && m.textContent),
              source: s && norm(s.textContent) ? norm(s.textContent) : null, buttons: [...n.querySelectorAll(".notification-list-item-buttons-container .monaco-button")].map((x) => norm(x.textContent)) };
          })) };
          await page.keyboard.press("Escape");
          break;
        }
        const txt = await page.evaluate(() => [...document.querySelectorAll(".notifications-center .notification-list-item")].map((n) => {
          const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
          const m = n.querySelector(".notification-list-item-message"); const s = n.querySelector(".notification-list-item-source");
          const b = [...n.querySelectorAll(".notification-list-item-buttons-container .monaco-button")].map((x) => norm(x.textContent));
          return "- " + norm(m && m.textContent) + (s ? "  [source: " + norm(s.textContent) + "]" : "") + (b.length ? "  buttons: " + b.join(" | ") : "");
        }).join("\n"));
        console.log("NOTIFICATION CENTER:\n" + (txt || "(empty)"));
        await page.keyboard.press("Escape");
        break;
      }
      case "editor": {
        const t = await page.evaluate(() => {
          const tab = document.querySelector(".tabs-container .tab.active");
          const lines = [...document.querySelectorAll(".editor-group-container.active .view-lines .view-line")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((l) => l.textContent.replace(/ /g, " "));
          return "EDITOR: " + (tab ? tab.getAttribute("aria-label") : "(none)") + "\n" + lines.slice(0, 60).join("\n");
        });
        if (JSON_MODE) {
          RESULT = await page.evaluate(() => {
            const tab = document.querySelector(".tabs-container .tab.active");
            const lines = [...document.querySelectorAll(".editor-group-container.active .view-lines .view-line")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((l) => l.textContent.replace(/\u00a0/g, " "));
            return { editor: tab ? tab.getAttribute("aria-label") : null, lines: lines.slice(0, 60) };
          });
          break;
        }
        console.log(t);
        break;
      }
      case "terminal": {
        const t = await page.evaluate(() => {
          const rows = [...document.querySelectorAll(".terminal-wrapper.active .xterm-rows > div, .xterm-accessibility-tree div")].map((d) => d.textContent).filter((s) => s.trim());
          const tabs = [...document.querySelectorAll(".terminal-tabs-entry, .single-terminal-tab")].map((x) => x.getAttribute("aria-label") || x.textContent.trim());
          return "TERMINAL TABS: " + tabs.join(" | ") + "\n" + rows.slice(-80).join("\n");
        });
        console.log(t);
        break;
      }
      case "shot": {
        const f = path.join(OBS, (args[0] || "shot-" + Date.now()) + ".png");
        await page.screenshot({ path: f });
        console.log("saved " + f);
        break;
      }
      case "settings-editor":
      case "setting-input":
      case "settings-search": {
        const payload = sub === "settings-search" ? await verbSettingsSearch(page, args.join(" "))
          : sub === "settings-editor" ? await verbSettingsEditor(page, args.length ? JSON.parse(args[0]) : {})
          : await verbSettingInput(page, args.length ? JSON.parse(args[0]) : {});
        if (JSON_MODE) Object.assign(RESULT, payload);
        else console.log(JSON.stringify(payload, null, 1));
        if (sub !== "settings-editor") await printState(page, 300);
        break;
      }
      case "panel":
      case "open":
      case "goto":
      case "suggest":
      case "hovertext":
      case "markers":
      case "tokens":
      case "folds":
      case "outline":
      case "breadcrumbs": {
        const payload = await EDITOR_VERBS[sub](page, editorOpts);
        if (JSON_MODE) Object.assign(RESULT, payload);
        else console.log(editorText(sub, payload));
        break;
      }
      default:
        console.log("unknown subcommand: " + sub + " (run: lab help)");
    }
    const refused = await publishRefused(all);
    if (refused) { fail(PUBLISH_MSG + ": \"" + refused + "\" was not activated"); process.exitCode = 1; }
  } finally {
    await browser.close().catch(() => {});
  }
  if (JSON_MODE && RESULT && JSON_VERBS.has(sub)) {
    console.log(JSON.stringify(RESULT));
    if (RESULT.ok === false) process.exitCode = 1;
  }
}
/* R-56 (2026-10-02, lesson 38): the lab never publishes. Whatever selected the window (a title, #n) or the control (a
   label, a key loop, a typed filter then Enter), the driver refuses to activate a control that previews or creates
   something on GitHub, signs in or up, logs in or authorizes: verbs naming one are refused before any window is touched,
   and every window and frame gets an interceptor that stops primary clicks on such a control, and Enter/Space while one
   (or the focused row of a list or menu) has the focus. Reading them (state, view, hover, rowmenu) stays allowed. */
const PUBLISH_SRC = "\\b(?:preview|create|publish)\\s+(?:on|to)\\s+github\\b|\\bsign[\\s-]*(?:in|up)\\b|\\blog\\s*in\\b|\\bauthori[sz]e\\b";
const PUBLISH_RE = new RegExp(PUBLISH_SRC, "i");
const PUBLISH_ACTIVATIONS = new Set(["button", "click", "pick", "check", "link", "rowaction", "viewaction", "menu", "cmd", "palette"]);
function publishBarrierInPage(src) {
  if (window.__labR56) return;
  window.__labR56 = true;
  const re = new RegExp(src, "i");
  const CONTROL = "button, a, input[type=submit], input[type=button], .monaco-button, [role=button], [role=menuitem], .action-label, .action-item, .monaco-list-row";
  const label = (el) => {
    const c = el && el.closest ? el.closest(CONTROL) : null;
    if (!c) return "";
    return [c.getAttribute("aria-label"), c.getAttribute("title"), c.value, (c.textContent || "").slice(0, 300)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  };
  const refuse = (e, l) => { e.stopImmediatePropagation(); e.preventDefault(); window.__labR56Refused = l.slice(0, 120); };
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"]) {
    window.addEventListener(t, (e) => { if (e.button !== 0) return; const l = label(e.target); if (l && re.test(l)) refuse(e, l); }, true);
  }
  const keyed = (e) => {
    if (!["Enter", " ", "Spacebar"].includes(e.key) && !["Enter", "NumpadEnter", "Space"].includes(e.code)) return;
    const a = document.activeElement;
    /* a list's focused row; a quick pick's or menu's focused row only while that widget is shown (a hidden quick pick
       keeps its last rows in the DOM) */
    const shown = (el) => !!el && !!(el.offsetParent || el.getClientRects().length);
    const qi = document.querySelector(".quick-input-widget"), menu = document.querySelector(".monaco-menu");
    const cands = [a, a && a.querySelector ? a.querySelector(".monaco-list-row.focused") : null,
      shown(qi) ? qi.querySelector(".monaco-list-row.focused") : null, shown(menu) ? menu.querySelector(".action-item.focused") : null];
    for (const c of cands) { const l = label(c); if (l && re.test(l)) { refuse(e, l); return; } }
  };
  window.addEventListener("keydown", keyed, true);
  window.addEventListener("keypress", keyed, true);
  window.addEventListener("keyup", keyed, true);
}
async function armPublishBarrier(pages) {
  for (const p of pages) for (const f of p.frames()) await f.evaluate(publishBarrierInPage, PUBLISH_SRC).catch(() => {});
}
async function publishRefused(pages) {
  for (const p of pages) for (const f of p.frames()) {
    const l = await f.evaluate(() => { const v = window.__labR56Refused; window.__labR56Refused = null; return v || null; }).catch(() => null);
    if (l) return l;
  }
  return null;
}
const PUBLISH_MSG = "REFUSED (R-56): the lab never publishes, signs in or sends data online; the Issue Reporter and every such flow are open, read and close only (AGENTS.md)";
/* verbs whose LAB_JSON output is one JSON object (the rest print text as always) */
const JSON_VERBS = new Set(["state", "windows", "view", "items", "notifications", "notifications-seen", "editor", "cmd", "palette", "pick", "check", "type", "typeraw", "key", "viewaction", "button", "link", "remote", "rowmenu", "rowaction", "menu", "focus", "hover", "wait",
  "panel", "open", "goto", "suggest", "hovertext", "markers", "tokens", "folds", "outline", "breadcrumbs", "settings-editor", "setting-input", "settings-search"]);
main().then(r63Enforce).then(hostSleepNote).catch((e) => {
  hostSleepNote();
  if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: "lab error: " + e.message.split("\n")[0], errorDetail: e.message.slice(0, 3000) }));
  console.error("lab error: " + e.message); process.exit(1);
});
