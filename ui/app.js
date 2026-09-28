/**
 * Dev Deck, the panel: three tabs (Sessions, Processes, Cleanup), one row per
 * session or project, details on click. Rust provides the data: `list` every 3
 * seconds, `sessions` every 15; Rust performs the actions (`kill`, `restart`,
 * `open_*`, `describe_session`, `shadow_*`) and re-checks the pids.
 *
 * Outside Tauri (opened in a browser, to try it out) it uses fake data: `DEMO`.
 */
(function () {
  "use strict";

  var REFRESH_MS = 3000;
  var SESSIONS_MS = 15000;
  var TAB_KEY = "devdeck.tab";
  var tauri = window.__TAURI__ && window.__TAURI__.core;
  var CL = window.DevDeckCleanup;

  var groups = [];
  var sessionsList = [];
  var shadow = [];
  var filterText = "";
  var describing = {};
  var describeSettings = { enabled: false, forced: false };
  /** The open rows (sessions, projects, MCP sections): they stay open when the list is redrawn. */
  var openKeys = new Set();
  var shapes = { processes: "", sessions: "", cleanup: "" };

  /* ---------- the bridge to Rust ---------- */

  function call(cmd, args) {
    if (tauri) return tauri.invoke(cmd, args || {});
    return DEMO.call(cmd, args || {});
  }

  /* ---------- formats ---------- */

  function mb(bytes) {
    var m = bytes / 1048576;
    return m >= 1024 ? (m / 1024).toFixed(1) + " GB" : Math.round(m) + " MB";
  }
  function since(sec) {
    if (sec < 60) return Math.round(sec) + " s";
    var m = Math.floor(sec / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " h " + (m % 60) + " min";
    return Math.floor(h / 24) + " d " + (h % 24) + " h";
  }
  function cpu(x) { return x < 0.5 ? "0%" : Math.round(x) + "%"; }
  function agoSec(epoch) {
    if (!epoch) return null;
    var sec = Math.max(0, Math.round(Date.now() / 1000 - epoch));
    return sec < 60 ? "just now" : since(sec) + " ago";
  }
  function agoIso(iso) { return agoSec(Date.parse(iso) / 1000); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "on") Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] === true) e.setAttribute(k, "");
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null && c !== false) e.append(c); });
    return e;
  }
  function icon(name) { return h("wa-icon", { name: name, "aria-hidden": "true" }); }

  /** A button inside a clickable row: it neither opens nor closes the row. */
  function act(fn) {
    return function (e) { e.preventDefault(); e.stopPropagation(); fn(); };
  }
  function iconButton(name, label, onClick, danger) {
    return h("wa-button", {
      size: "small", appearance: "plain", class: danger ? "danger" : null,
      title: label, "aria-label": label, on: { click: act(onClick) }
    }, [icon(name)]);
  }

  /** A row that opens: <details> with the key to remember its state. */
  function row(key, summaryChildren, detailChildren, extraClass) {
    return h("details", { class: "row" + (extraClass ? " " + extraClass : ""), "data-key": key, open: openKeys.has(key), role: "listitem" }, [
      h("summary", {}, summaryChildren),
      h("div", { class: "detail" }, detailChildren)
    ]);
  }
  document.addEventListener("toggle", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-key");
    if (k) { if (e.target.open) openKeys.add(k); else openKeys.delete(k); }
  }, true);

  function facts(pairs) {
    var dl = h("dl", { class: "facts" });
    pairs.forEach(function (p) {
      if (!p || p[1] == null || p[1] === "") return;
      dl.append(h("dt", { text: p[0] }), h("dd", { class: p[2] ? "mono" : null, text: String(p[1]) }));
    });
    return dl;
  }

  function empty(iconName, text) {
    return h("div", { class: "empty" }, [icon(iconName), h("span", { text: text })]);
  }

  function matchesText(parts) {
    if (!filterText) return true;
    var hay = parts.join(" ").toLowerCase();
    return filterText.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  /* ---------- notices and confirmations ---------- */

  var errorTimer = null;
  function toast(msg, variant) {
    var box = document.getElementById("error");
    box.replaceChildren(h("wa-callout", { variant: variant || "danger", size: "small" }, [
      h("wa-icon", { slot: "icon", name: variant === "neutral" ? "circle-info" : "triangle-exclamation" }),
      document.createTextNode(String(msg))
    ]));
    box.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(function () { box.hidden = true; }, 6000);
  }
  function showError(msg) { toast(msg, "danger"); }

  function confirmAction(title, lines, goLabel, warn) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById("confirm");
      var go = document.getElementById("confirm-go");
      dlg.label = title;
      go.textContent = goLabel;
      var text = document.getElementById("confirm-text");
      text.replaceChildren();
      if (warn) text.append(h("wa-callout", { variant: "warning", size: "small", style: "margin-bottom:12px" }, [document.createTextNode(warn)]));
      var list = h("ul", { class: "mono", style: "font-size:12px;margin:0;padding-left:18px;color:var(--text-2)" });
      lines.forEach(function (l) { list.append(h("li", { text: l })); });
      text.append(list);
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        go.removeEventListener("click", onGo);
        dlg.removeEventListener("wa-after-hide", onHide);
        resolve(v);
      }
      function onGo() { dlg.open = false; finish(true); }
      function onHide(e) { if (e.target === dlg) finish(false); }
      go.addEventListener("click", onGo);
      dlg.addEventListener("wa-after-hide", onHide);
      dlg.open = true;
    });
  }

  /* ---------- process actions ---------- */

  function procLine(p) {
    return p.pid + "  " + p.runtime + (p.tool ? " · " + p.tool : "") + "  " + p.cmd.slice(0, 90);
  }
  var CLAUDE_WARN = "Claude Code is among these: stopping it closes the session.";

  async function killProcs(title, procs) {
    var ok = await confirmAction(title, procs.map(procLine), "Stop", procs.some(function (p) { return p.claude; }) ? CLAUDE_WARN : null);
    if (!ok) return;
    try { await call("kill", { pids: procs.map(function (p) { return p.pid; }) }); }
    catch (e) { showError("Not stopped: " + e); }
    refresh(true);
  }

  async function restartProc(group, p) {
    var ok = await confirmAction("Restart?", [procLine(p), "in " + (p.cwd || "?")], "Restart",
      p.claude ? CLAUDE_WARN : "It reopens in a new window, with the same command, the same folder and the same environment.");
    if (!ok) return;
    try { await call("restart", { pid: p.pid, title: group.name + " (Dev Deck)" }); }
    catch (e) { showError("Not restarted: " + e); }
    setTimeout(function () { refresh(true); }, 1500);
  }

  function openPort(port) { call("open_port", { port: port }).catch(showError); }
  function openFolder(path, editor) { call("open_folder", { path: path, editor: editor }).catch(showError); }

  /* ---------- Processes tab ---------- */

  function keyOf(g) { return g.root || "?"; }
  var byClaude = function (p) { return p.launcher === "claude"; };

  /** The MCP servers of a Claude Code group: "chrome-devtools-mcp, @playwright/mcp", without npx and without repeats. */
  function serversOf(procs) {
    var out = [];
    procs.forEach(function (p) {
      var t = p.tool || p.runtime;
      if (["npx", "npm", "node", "cmd"].indexOf(t) < 0 && out.indexOf(t) < 0) out.push(t);
    });
    return out.join(", ");
  }

  /** A project's tool chain: "npm → tsx", without consecutive repeats. */
  function chainOf(procs) {
    var out = [];
    procs.forEach(function (p) {
      var t = p.tool || p.runtime;
      if (out[out.length - 1] !== t) out.push(t);
    });
    return out.slice(0, 4).join(" → ") + (out.length > 4 ? " …" : "");
  }

  function groupMeta(g) { return mb(g.memory) + " · " + since(g.run_time); }
  function procMeta(p) { return "pid " + p.pid + " · " + mb(p.memory) + " · " + cpu(p.cpu) + " · " + since(p.run_time); }

  function procRow(g, p) {
    var acts = h("div", { class: "acts" });
    // Restarting an MCP server outside Claude is pointless: Claude relaunches it itself.
    if (p.depth === 0 && p.cwd && !byClaude(p)) acts.append(iconButton("rotate-right", "Restart (same command, folder and environment)", function () { restartProc(g, p); }));
    acts.append(iconButton("xmark", "Stop process " + p.pid + " and its children", function () {
      killProcs("Stop process " + p.pid + "?", [p]);
    }, true));
    return h("div", { class: "proc", "data-pid": p.pid }, [
      h("div", { class: "who" }, [
        p.depth ? h("span", { class: "branch", "aria-hidden": "true", text: "\u00a0\u00a0".repeat(p.depth - 1) + "└" }) : null,
        h("span", { class: "chip" }, [document.createTextNode(p.runtime)]),
        p.tool ? h("span", { class: "tool", text: p.tool }) : null,
        p.ports.length ? h("span", { class: "chip green mono", text: p.ports.map(function (x) { return ":" + x; }).join(" ") }) : null,
        h("span", { class: "cmd", text: p.cmd, title: p.cmd + (p.cwd ? "\n\nin " + p.cwd : "") })
      ]),
      h("span", { class: "meta mono hide-narrow", "data-live": "p:" + p.pid, text: procMeta(p) }),
      acts
    ]);
  }

  function groupRow(g) {
    var key = "g:" + keyOf(g);
    var mine = g.by_claude ? g.procs : g.procs.filter(function (p) { return !byClaude(p); });
    var theirs = g.by_claude ? [] : g.procs.filter(byClaude);

    var ports = g.ports.map(function (port) {
      return h("button", {
        class: "chip green port", type: "button", title: "Open http://localhost:" + port, "aria-label": "Open http://localhost:" + port,
        on: { click: act(function () { openPort(port); }) }
      }, [document.createTextNode(":" + port)]);
    });
    var acts = h("div", { class: "acts" }, [
      g.root ? iconButton("folder-open", "Open the folder", function () { openFolder(g.root, false); }) : null,
      g.root ? iconButton("code", "Open in VS Code", function () { openFolder(g.root, true); }) : null,
      iconButton("power-off", g.by_claude ? "Stop these MCP servers" : "Stop the project (not Claude Code's MCP servers)", function () {
        // Claude Code's MCP servers are kept aside: stopping them takes tools away from an open session.
        killProcs("Stop " + (g.by_claude ? "the MCP servers in \"" : "\"") + g.name + "\"?", mine);
      }, true)
    ]);

    var summary = [
      h("div", { class: "line" }, [
        h("wa-icon", { name: "chevron-right", class: "chev", "aria-hidden": "true" }),
        h("span", { class: "name", text: g.name })
      ].concat(ports).concat([
        h("span", { class: "chain grow", text: g.by_claude ? serversOf(mine) : chainOf(mine) }),
        h("span", { class: "meta mono hide-narrow", "data-live": "g:" + keyOf(g), text: groupMeta(g) }),
        acts
      ])),
      g.root ? h("div", { class: "path indent", text: g.root, title: g.root }) : null
    ];

    var detail = [h("div", { class: "tree" }, mine.map(function (p) { return procRow(g, p); }))];
    if (theirs.length) {
      var subKey = "sub:" + keyOf(g);
      detail.push(h("details", { class: "sub", "data-key": subKey, open: openKeys.has(subKey) }, [
        h("summary", { text: "+ " + plural(theirs.length, "process launched", "processes launched") + " by Claude Code (MCP servers)" }),
        h("div", { class: "tree" }, theirs.map(function (p) { return procRow(g, p); }))
      ]));
    }
    return row(key, summary, detail);
  }

  function groupMatches(g) {
    return matchesText([g.name, g.root || "", g.ports.join(" ")].concat(g.procs.map(function (p) { return p.cmd + " " + (p.tool || "") + " " + p.pid; })));
  }

  function renderProcesses() {
    var visible = groups.filter(groupMatches);
    var mine = visible.filter(function (g) { return !g.by_claude; });
    var claude = visible.filter(function (g) { return g.by_claude; });

    var shape = filterText + "|" + visible.map(function (g) {
      return keyOf(g) + ":" + g.ports.join(",") + ":" + g.procs.map(function (p) { return p.pid + "/" + p.depth + "/" + p.ports.join(","); }).join(",");
    }).join(";");
    if (shape === shapes.processes) {
      // Same processes: only memory, CPU and time update, and nothing flickers.
      var live = {};
      groups.forEach(function (g) {
        live["g:" + keyOf(g)] = groupMeta(g);
        g.procs.forEach(function (p) { live["p:" + p.pid] = procMeta(p); });
      });
      document.querySelectorAll("[data-live]").forEach(function (e) {
        var v = live[e.getAttribute("data-live")];
        if (v != null && e.textContent !== v) e.textContent = v;
      });
      return;
    }
    shapes.processes = shape;

    var main = document.getElementById("groups");
    main.replaceChildren.apply(main, mine.map(groupRow));
    var holder = main.parentElement;
    var old = holder.querySelector(":scope > .empty");
    if (old) old.remove();
    if (!mine.length) {
      main.after(empty("moon", filterText ? "Nothing matches the filter." : "No dev processes running. Enjoy your evening."));
    }

    var box = document.getElementById("claude-box");
    box.hidden = !claude.length;
    var n = claude.reduce(function (s, g) { return s + g.procs.length; }, 0);
    document.getElementById("claude-summary").textContent =
      "Launched by Claude Code · " + plural(n, "MCP server", "processes") + " in " + plural(claude.length, "folder", "folders");
    var cg = document.getElementById("claude-groups");
    cg.replaceChildren.apply(cg, claude.map(groupRow));
  }

  /* ---------- Sessions tab (outside cleanup: look, don't touch) ---------- */

  var KIND = { terminal: "terminal", vscode: "VS Code", background: "background" };

  function statusOf(s) {
    if (!s.last_activity) return { cls: "idle", label: "no transcript" };
    var age = Date.now() / 1000 - s.last_activity;
    if (age < 300) return { cls: "live", label: "active now" };
    if (age < 3600) return { cls: "recent", label: "active in the last hour" };
    return { cls: "idle", label: "idle" };
  }

  async function describeNow(pid) {
    describing[pid] = true;
    renderSessions(true);
    try { await call("describe_session", { pid: pid }); }
    catch (e) { showError("Description failed: " + e); }
    delete describing[pid];
    await loadSessions();
  }

  function sessionRow(x) {
    var s = x.session, d = x.description;
    var st = statusOf(s);
    var busy = !!describing[s.pid];
    var acts = h("div", { class: "acts" }, [
      s.transcript && describeSettings.enabled ? h("wa-button", {
        size: "small", appearance: "plain", loading: busy, disabled: busy,
        title: "Redo the description now (claude -p, a few seconds)", "aria-label": "Describe again", on: { click: act(function () { describeNow(s.pid); }) }
      }, [h("wa-icon", { slot: "start", name: "wand-magic-sparkles", "aria-hidden": "true" }), h("span", { class: "hide-narrow", text: "Describe" })]) : null,
      s.cwd ? iconButton("folder-open", "Open the folder", function () { openFolder(s.cwd, false); }) : null
    ]);
    var badges = [h("span", { class: "chip" }, [document.createTextNode(KIND[s.kind] || s.kind)])];
    if (s.match === "uncertain") badges.push(h("span", { class: "chip amber", title: "Several possible transcripts, or created long after start: took the most recently written one" }, [document.createTextNode("uncertain transcript")]));

    var desc = d
      ? h("p", { class: "desc indent" + (x.description_fresh ? "" : " old"), text: d.text })
      : h("p", { class: "desc none indent", text: !s.transcript ? "Nothing written yet." : describeSettings.enabled ? "No description yet: it writes itself within a few minutes, or press \"Describe\"." : "Descriptions are off." });

    var summary = [
      h("div", { class: "line" }, [
        h("wa-icon", { name: "chevron-right", class: "chev", "aria-hidden": "true" }),
        h("span", { class: "dot " + st.cls, role: "img", "aria-label": st.label, title: st.label }),
        h("span", { class: "name", text: s.project || "?" })
      ].concat(badges).concat([
        h("span", { class: "grow" }),
        h("span", { class: "meta", text: s.last_activity ? agoSec(s.last_activity) : "" }),
        acts
      ])),
      desc,
      s.last_prompt ? h("p", { class: "prompt indent", title: s.last_prompt, text: "» " + s.last_prompt }) : null
    ];
    var detail = [facts([
      ["Title", s.title],
      ["Folder", s.cwd, true],
      ["Process", "pid " + s.pid + " · open for " + since(s.run_time) + " · " + mb(s.memory)],
      ["Children", s.children ? plural(s.children, "process", "processes") + " · " + mb(s.children_memory) : "none"],
      ["Session", s.session_id, true],
      ["Transcript", s.transcript, true],
      ["Match", { id: "by the id in the command", time: "by time: the only one created after start", uncertain: "uncertain: took the most recently written one", none: "no transcript" }[s.match]],
      ["Description", d ? "written " + agoSec(d.at) + (x.description_fresh ? ", up to date" : ", the session has moved on since") : "none yet"]
    ])];
    return row("s:" + s.pid, summary, detail);
  }

  function sessionMatches(x) {
    var s = x.session;
    return matchesText([s.project || "", s.title || "", s.cwd || "", s.last_prompt || "", KIND[s.kind] || "", x.description ? x.description.text : ""]);
  }

  function renderSessions(force) {
    var now = Date.now() / 1000;
    var recent = sessionsList.filter(function (x) { return x.session.last_activity && now - x.session.last_activity < 3600; }).length;
    document.getElementById("sessions-lede").textContent =
      sessionsList.length + " open · " + recent + " active in the last hour" + (describeSettings.enabled ? " · descriptions refresh on their own every 30 min" : "");
    setCount("sessions", sessionsList.length);

    var visible = sessionsList.filter(sessionMatches);
    var shape = filterText + "|" + describeSettings.enabled + "|" + JSON.stringify(visible.map(function (x) {
      return [x.session.pid, x.session.session_id, x.description && x.description.at, x.description_fresh, Math.floor((x.session.last_activity || 0) / 60)];
    }).concat(Object.keys(describing)));
    if (!force && shape === shapes.sessions) return;
    shapes.sessions = shape;
    var el = document.getElementById("sessions");
    el.replaceChildren.apply(el, visible.map(sessionRow));
    var panel = el.parentElement;
    var old = panel.querySelector(":scope > .empty");
    if (old) old.remove();
    if (!visible.length) el.after(empty("terminal", filterText ? "No session matches the filter." : "No Claude Code sessions open."));
  }

  /* Descriptions are opt-in: they send transcript tails to claude -p and cost tokens. */
  var describeSwitch = document.getElementById("describe-switch");

  async function loadDescribeSettings() {
    try { describeSettings = await call("describe_settings") || describeSettings; } catch (e) { /* keep them off */ }
    describeSwitch.checked = describeSettings.enabled;
    describeSwitch.disabled = describeSettings.forced;
    describeSwitch.title = describeSettings.forced ? "Set by DEVDECK_DESCRIBE" : "";
    renderSessions(true);
  }

  describeSwitch.addEventListener("change", async function () {
    try { await call("set_describe", { on: describeSwitch.checked }); }
    catch (e) { showError("Could not save the setting: " + e); }
    await loadDescribeSettings();
  });

  async function loadSessions() {
    if (document.hidden) return;
    try { sessionsList = await call("sessions"); } catch (e) { sessionsList = []; }
    renderSessions();
  }

  /* ---------- Cleanup tab, in shadow mode (cleanup.js + ~/.dev-deck/shadow.jsonl) ---------- */

  function newId() {
    return (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8);
  }

  /** Proposals still without a verdict, most recent first. */
  function pendingProposals() {
    var judged = {};
    shadow.forEach(function (r) { if (r.type === "verdict") judged[r.proposal] = true; });
    return shadow.filter(function (r) { return r.type === "proposal" && !judged[r.id]; }).reverse();
  }

  async function loadShadow() {
    try { shadow = await call("shadow_read"); } catch (e) { shadow = []; }
    setCount("cleanup", pendingProposals().length, true);
    renderCleanup();
  }

  function write(record) { return call("shadow_append", { record: record }); }

  /** The proposal's process is still the same one: same pid, same command. */
  function stillAlive(r) {
    return groups.some(function (g) { return g.procs.some(function (p) { return p.pid === r.pid && p.cmd === r.cmd; }); });
  }

  async function judge(r, verdict, note, kill) {
    try {
      if (kill && stillAlive(r)) {
        var ok = true, error = null;
        try { await call("kill", { pids: [r.pid] }); } catch (e) { ok = false; error = String(e); }
        await write({ type: "action", at: new Date().toISOString(), source: "panel", action: "kill", pids: [r.pid], reason: "cleanup: " + r.category, proposal: r.id, ok: ok, error: error || undefined });
        if (!ok) showError("Not stopped: " + error);
      }
      await write({ type: "verdict", at: new Date().toISOString(), proposal: r.id, verdict: verdict, note: note || undefined });
    } catch (e) { showError("Verdict not saved: " + e); }
    await loadShadow();
    refresh(true);
  }

  function proposalCard(r) {
    var alive = stillAlive(r);
    var from = r.source === "claude" ? "from Claude Code" + (r.session ? " (session " + r.session + ")" : "") : "from the panel";
    var note = h("wa-input", { size: "small", placeholder: "why (optional)", "aria-label": "Why, optional" });
    return h("article", { class: "proposal", "data-id": r.id }, [
      h("div", { class: "line" }, [
        h("span", { class: "name", text: (r.root ? r.root.split(/[\\/]/).pop() : "?") }),
        h("span", { class: "chip mono", text: "pid " + r.pid }),
        r.pids && r.pids.length > 1 ? h("span", { class: "meta", text: "+ " + plural(r.pids.length - 1, "child", "children") }) : null,
        alive ? null : h("span", { class: "chip", text: "gone" }),
        h("span", { class: "grow" }),
        h("span", { class: "meta", text: from + " · " + agoIso(r.at) })
      ]),
      h("div", { class: "cmd", text: r.cmd, title: r.cmd }),
      h("ul", { class: "evidence" }, r.evidence.map(function (e) { return h("li", { text: e }); })),
      h("div", { class: "answer" }, [
        note,
        alive ? h("wa-button", { size: "small", variant: "danger", on: { click: function () { judge(r, "close", note.value, true); } } }, [document.createTextNode("Close")]) : null,
        h("wa-button", { size: "small", appearance: "outlined", on: { click: function () { judge(r, alive ? "keep" : "close", note.value, false); } } },
          [document.createTextNode(alive ? "Right, keep it" : "Right (already closed)")]),
        h("wa-button", { size: "small", appearance: "outlined", on: { click: function () { judge(r, "wrong", note.value, false); } } }, [document.createTextNode("Wrong")])
      ])
    ]);
  }

  function renderCleanup() {
    var pend = pendingProposals().filter(function (r) { return matchesText([r.cmd, r.root || "", r.category, String(r.pid)]); });
    var shape = filterText + "|" + pend.map(function (r) { return r.id + stillAlive(r); }).join(",");
    if (shape === shapes.cleanup) return;
    shapes.cleanup = shape;
    var list = document.getElementById("cleanup-list");
    if (!pend.length) {
      list.replaceChildren(empty("broom", filterText ? "No proposal matches the filter." : "Nothing to judge. \"Scan now\" looks at the whole machine."));
      return;
    }
    var nodes = [];
    CL.CATEGORIES.concat(["?"]).forEach(function (cat) {
      var of = pend.filter(function (r) { return cat === "?" ? CL.CATEGORIES.indexOf(r.category) < 0 : r.category === cat; });
      if (!of.length) return;
      nodes.push(h("h2", { class: "section-title", text: (CL.LABELS[cat] || "Other") + " · " + of.length }));
      of.forEach(function (r) { nodes.push(proposalCard(r)); });
    });
    list.replaceChildren.apply(list, nodes);
  }

  /** From the panel: the whole machine, no session. Identical proposals, or ones already dismissed, are not repeated. */
  async function scan() {
    await refresh(true);
    var open = pendingProposals();
    var verdicts = {};
    shadow.forEach(function (r) { if (r.type === "verdict") verdicts[r.proposal] = r.verdict; });
    var dismissed = shadow.filter(function (r) { return r.type === "proposal" && (verdicts[r.id] === "keep" || verdicts[r.id] === "wrong"); });
    open = open.concat(dismissed);
    var props = CL.propose(groups, {});
    var added = 0;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      var dup = open.some(function (o) { return o.category === p.category && o.pid === p.pid && o.cmd === p.cmd; });
      if (dup) continue;
      await write({
        type: "proposal", id: newId(), at: new Date().toISOString(), source: "panel", session: null, projects: [],
        category: p.category, pid: p.pid, pids: p.pids, cmd: p.cmd, root: p.root, ports: p.ports, evidence: p.evidence
      });
      added++;
    }
    await loadShadow();
    if (!props.length) toast("No proposals: nothing orphaned, duplicated or idle for long.", "neutral");
    else if (!added) toast("No new proposals: the ones found are already waiting for a verdict, or you dismissed them.", "neutral");
  }
  document.getElementById("cleanup-scan").addEventListener("click", scan);

  /* ---------- header, tabs, filter ---------- */

  function setCount(tab, n, attention) {
    var el = document.getElementById("count-" + tab);
    el.textContent = String(n);
    if (attention) el.hidden = !n;
  }

  function renderHeader() {
    var mine = groups.filter(function (g) { return !g.by_claude; });
    var nProcs = groups.reduce(function (s, g) { return s + g.procs.length; }, 0);
    var mem = groups.reduce(function (s, g) { return s + g.memory; }, 0);
    document.getElementById("summary").textContent =
      plural(mine.length, "project", "projects") + " · " + plural(nProcs, "process", "processes") + " · " + mb(mem) + (tauri ? "" : " · demo");
    setCount("processes", mine.length);
  }

  var tabs = document.getElementById("tabs");
  var PLACEHOLDER = { sessions: "Filter sessions", processes: "Filter projects, commands, ports", cleanup: "Filter proposals" };
  function currentTab() { return tabs.getAttribute("active") || "sessions"; }
  function onTab(name) {
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* without storage we start again from sessions */ }
    document.getElementById("filter").placeholder = PLACEHOLDER[name] || "Filter";
  }
  (function restoreTab() {
    var saved = null;
    try { saved = localStorage.getItem(TAB_KEY); } catch (e) { saved = null; }
    var name = PLACEHOLDER[saved] ? saved : "sessions";
    tabs.setAttribute("active", name);
    onTab(name);
  })();
  tabs.addEventListener("wa-tab-show", function (e) { onTab(e.detail && e.detail.name ? e.detail.name : currentTab()); });

  var filter = document.getElementById("filter");
  filter.addEventListener("input", function () {
    filterText = (filter.value || "").trim().toLowerCase();
    renderProcesses();
    renderSessions(true);
    renderCleanup();
  });
  // "/" jumps to the filter; Esc clears it.
  document.addEventListener("keydown", function (e) {
    var inField = /input|textarea/i.test((e.composedPath()[0] || {}).tagName || "");
    if (e.key === "/" && !inField) { e.preventDefault(); filter.focus(); }
    if (e.key === "Escape" && inField && filter.value) { filter.value = ""; filter.dispatchEvent(new Event("input")); }
  });

  /* ---------- the loop ---------- */

  var busy = false;
  async function refresh(force) {
    if (busy || (!force && document.hidden)) return;
    busy = true;
    try {
      groups = await call("list");
      renderHeader();
      renderProcesses();
      loadShadow();
    } catch (e) {
      showError("Can't read the processes: " + e);
    } finally {
      busy = false;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { refresh(true); loadSessions(); }
  });

  /* ---------- demo, outside Tauri ---------- */

  var DEMO = {
    describe: false,
    groups: [
      { root: "C:\\Users\\dev\\code\\acme-shop\\backend", name: "backend", ports: [8792], memory: 180e6, cpu: 1.2, run_time: 5400, by_claude: false, procs: [
        { pid: 8364, parent: 1, runtime: "node", tool: "npm", cmd: "\"C:\\Program Files\\nodejs\\node.exe\" npm-cli.js start", cwd: "C:\\Users\\dev\\code\\acme-shop\\backend", memory: 50e6, cpu: 0, run_time: 5400, ports: [], depth: 0, claude: false, launcher: null },
        { pid: 2164, parent: 8364, runtime: "node", tool: "tsx", cmd: "node node_modules\\tsx\\dist\\cli.mjs src/index.ts", cwd: null, memory: 40e6, cpu: 0.2, run_time: 5399, ports: [], depth: 1, claude: false, launcher: null },
        { pid: 33004, parent: 2164, runtime: "node", tool: "tsx", cmd: "node --import tsx/loader.mjs src/index.ts", cwd: "C:\\Users\\dev\\code\\acme-shop\\backend", memory: 90e6, cpu: 1, run_time: 5398, ports: [8792], depth: 2, claude: false, launcher: null },
        { pid: 7001, parent: 3, runtime: "node", tool: "@playwright/mcp", cmd: "node @playwright/mcp", cwd: "C:\\Users\\dev\\code\\acme-shop\\backend", memory: 30e6, cpu: 0, run_time: 3000, ports: [], depth: 0, claude: false, launcher: "claude" }
      ] },
      { root: "C:\\Users\\dev\\code\\blog", name: "blog", ports: [8765], memory: 12e6, cpu: 0, run_time: 86000, by_claude: false, procs: [
        { pid: 22008, parent: 1, runtime: "python", tool: null, cmd: "C:\\Python312\\python.exe tracker/serve.py 8765", cwd: "C:\\Users\\dev\\code\\blog", memory: 12e6, cpu: 0, run_time: 86000, ports: [8765], depth: 0, claude: false, launcher: null }
      ] },
      { root: "C:\\Users\\dev\\code\\scraper", name: "scraper", ports: [], memory: 90e6, cpu: 0.4, run_time: 7200, by_claude: true, procs: [
        { pid: 19600, parent: 5, runtime: "node", tool: "npx", cmd: "node npx-cli.js chrome-devtools-mcp@latest", cwd: "C:\\Users\\dev\\code\\scraper", memory: 45e6, cpu: 0.2, run_time: 7200, ports: [], depth: 0, claude: false, launcher: "claude" },
        { pid: 16836, parent: 19600, runtime: "node", tool: "chrome-devtools-mcp", cmd: "node chrome-devtools-mcp", cwd: "C:\\Users\\dev\\code\\scraper", memory: 45e6, cpu: 0.2, run_time: 7199, ports: [], depth: 1, claude: false, launcher: "claude" }
      ] }
    ],
    sessions: [
      { session: { pid: 2372, kind: "terminal", cwd: "C:\\Users\\dev\\code\\dev-deck", project: "dev-deck", run_time: 27000, session_id: "401e68e7-18bf-46a4-a2a7-9ed7a48f31b2", transcript: "C:\\Users\\dev\\.claude\\projects\\x\\401e68e7.jsonl", match: "time", title: "MCP in the repo", last_prompt: "ok, I was thinking of also adding the open Claude Code processes", last_activity: Date.now() / 1000 - 30, transcript_size: 1, memory: 250e6, children: 8, children_memory: 69e6 }, description: null, description_fresh: false },
      { session: { pid: 16264, kind: "vscode", cwd: "C:\\Users\\dev\\code\\acme-shop", project: "acme-shop", run_time: 170000, session_id: "7b621175-b63f-4ae5-9ffe-63482dd0bb92", transcript: "y.jsonl", match: "id", title: "Card-based onboarding", last_prompt: "yes, go ahead", last_activity: Date.now() / 1000 - 700, transcript_size: 1, memory: 200e6, children: 7, children_memory: 11e6 }, description: { text: "Testing the acme-shop onboarding cards against the real backend.", at: Date.now() / 1000 - 4000, fingerprint: "a" }, description_fresh: false },
      { session: { pid: 3856, kind: "vscode", cwd: "C:\\Users\\dev\\code\\scraper", project: "scraper", run_time: 175000, session_id: "0da7952e", transcript: "z.jsonl", match: "uncertain", title: "Scraper with Playwright", last_prompt: "hi! in this repo we use Playwright", last_activity: Date.now() / 1000 - 127000, transcript_size: 1, memory: 180e6, children: 7, children_memory: 11e6 }, description: { text: "The effort slider in the panel is implemented and working.", at: Date.now() / 1000 - 90000, fingerprint: "b" }, description_fresh: true }
    ],
    shadow: [
      { type: "proposal", id: "demo0001", at: new Date(Date.now() - 600000).toISOString(), source: "claude", session: 3844, projects: [],
        category: "duplicate", pid: 16836, pids: [16836], cmd: "node chrome-devtools-mcp", root: "C:\\Users\\dev\\code\\scraper", ports: [],
        evidence: ["same command and same folder as pid 19600", "this one has been running for 2 h, the other for 2 h", "this one has no open ports"] }
    ],
    call: function (cmd, args) {
      if (cmd === "list") return Promise.resolve(JSON.parse(JSON.stringify(DEMO.groups)));
      if (cmd === "kill") {
        DEMO.groups.forEach(function (g) { g.procs = g.procs.filter(function (p) { return args.pids.indexOf(p.pid) < 0; }); });
        DEMO.groups = DEMO.groups.filter(function (g) { return g.procs.length; });
        return Promise.resolve(args.pids.length);
      }
      if (cmd === "sessions") return Promise.resolve(DEMO.sessions);
      if (cmd === "describe_settings") return Promise.resolve({ enabled: DEMO.describe, forced: false });
      if (cmd === "set_describe") { DEMO.describe = args.on; return Promise.resolve(null); }
      if (cmd === "describe_session") return new Promise(function (r) { setTimeout(function () { DEMO.sessions[0].description = { text: "Redesigning the Dev Deck panel: three tabs, compact rows, a slate and green palette.", at: Date.now() / 1000, fingerprint: "x" }; DEMO.sessions[0].description_fresh = true; r(DEMO.sessions[0].description); }, 800); });
      if (cmd === "shadow_read") return Promise.resolve(DEMO.shadow.slice());
      if (cmd === "shadow_append") { DEMO.shadow.push(args.record); return Promise.resolve(null); }
      console.log("[demo]", cmd, args);
      return Promise.resolve(null);
    }
  };

  // At the bottom: DEMO must exist before the first read.
  setInterval(refresh, REFRESH_MS);
  setInterval(loadSessions, SESSIONS_MS);
  refresh(true);
  loadSessions();
  loadDescribeSettings();
})();
