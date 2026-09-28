/**
 * The cleanup rules: from the groups of `list` (or `devdeck list`) to
 * proposals, each with a category and its evidence. Nothing gets closed here:
 * the caller decides. The same rules serve the panel (in the browser, as
 * `window.DevDeckCleanup`) and the MCP for Claude Code (in Node, via `require`).
 *
 * Categories, from safest to least safe:
 *   orphan-mcp   an MCP server whose parent is gone and that belongs to no
 *                live Claude Code session
 *   duplicate    same command in the same folder as another process still
 *                running: the one with the port stays, or else the oldest
 *   session      started by this Claude Code session (a background server,
 *                not an MCP): to close when the session is done
 *   idle         running for more than IDLE_HOURS, zero CPU, no port in its tree
 *
 * Never proposed: Claude Code, MCP servers of live sessions, Dev Deck.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DevDeckCleanup = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var IDLE_HOURS = 12;
  var CATEGORIES = ["orphan-mcp", "duplicate", "session", "idle"];

  function isMcp(p) {
    return /(^|[\s\\/@_-])mcp([\s\\/@_.-]|$)|mcp-|-mcp/i.test((p.tool || "") + " " + p.cmd);
  }

  function norm(path) {
    return String(path || "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  }

  /** `path` is inside (or equal to) one of the `projects` folders. */
  function inProjects(path, projects) {
    var p = norm(path);
    if (!p) return false;
    return projects.some(function (x) {
      var q = norm(x);
      return q && (p === q || p.indexOf(q + "/") === 0 || q.indexOf(p + "/") === 0);
    });
  }

  /** The command without differences that don't matter (spaces, slashes, Windows casing). */
  function sameCmd(p) {
    return p.cmd.replace(/\\\\/g, "\\").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function mins(sec) { return Math.round(sec / 60); }
  /** "40 min", "3.4 h". */
  function age(sec) { return sec < 3600 ? mins(sec) + " min" : String(Math.round(sec / 360) / 10) + " h"; }

  /**
   * The pids of `p`'s tree within the group (itself and its descendants). It
   * follows Rust's tree order (each process followed by its descendants, with
   * `depth`), not the parent pids: between npm and tsx on Windows there is a
   * cmd.exe that isn't in the list, and following parents breaks the tree (9/26:
   * the acme-shop backend showed up "without ports" with 8792 open by the grandchild).
   */
  function treeOf(p, group) {
    var i = group.procs.indexOf(p);
    var out = [p.pid];
    for (var j = i + 1; j < group.procs.length && group.procs[j].depth > p.depth; j++) out.push(group.procs[j].pid);
    return out;
  }
  function treePorts(p, group) {
    var pids = treeOf(p, group);
    var ports = [];
    group.procs.forEach(function (c) { if (pids.indexOf(c.pid) >= 0) ports = ports.concat(c.ports); });
    return ports.filter(function (x, i) { return ports.indexOf(x) === i; });
  }

  /**
   * @param groups  the groups from `list`
   * @param ctx     { session: pid of the Claude Code asking (or null, from the panel),
   *                  projects: folders it works on (empty = all), idleHours? }
   * @returns proposals [{ id, category, pid, pids, root, project, cmd, evidence[], ports }]
   */
  function propose(groups, ctx) {
    ctx = ctx || {};
    var projects = ctx.projects || [];
    var idleSec = (ctx.idleHours || IDLE_HOURS) * 3600;
    var session = ctx.session || null;

    // Live Claude Code sessions: those that show up as someone's ancestor.
    var liveSessions = {};
    groups.forEach(function (g) { g.procs.forEach(function (p) { if (p.claude_pid) liveSessions[p.claude_pid] = true; }); });

    var out = [];
    var taken = {};
    function add(category, g, p, evidence) {
      if (taken[p.pid]) return;
      var pids = treeOf(p, g);
      pids.forEach(function (x) { taken[x] = true; });
      out.push({
        id: category + ":" + p.pid,
        category: category,
        pid: p.pid,
        pids: pids,
        root: g.root,
        project: g.name,
        cmd: p.cmd,
        ports: treePorts(p, g),
        evidence: evidence
      });
    }

    groups.forEach(function (g) {
      var inScope = function (p) {
        if (session && p.claude_pid === session) return true;
        return !projects.length || inProjects(g.root, projects);
      };
      // The roots (depth 0): the root is proposed, the tree goes with it.
      var roots = g.procs.filter(function (p) { return p.depth === 0; });

      roots.forEach(function (p) {
        if (p.claude || !inScope(p)) return;
        var mcp = isMcp(p);
        var liveOwner = p.claude_pid && liveSessions[p.claude_pid];

        // 1. Orphan MCP: no live session above it, and the parent is gone.
        if (mcp && !p.claude_pid && !p.parent_alive) {
          add("orphan-mcp", g, p, [
            "MCP server with no live Claude Code session above it",
            "the process that launched it is gone",
            "running for " + age(p.run_time)
          ]);
          return;
        }
        // An MCP server of a live session is never touched.
        if (mcp && liveOwner) return;

        // 2. Duplicate: same command, same folder, another process running.
        var twins = roots.filter(function (q) {
          return q.pid !== p.pid && !q.claude && sameCmd(q) === sameCmd(p) && norm(q.cwd) === norm(p.cwd);
        });
        if (twins.length) {
          var all = twins.concat([p]);
          // The one with a port stays; on a tie, the oldest.
          var keep = all.slice().sort(function (a, b) {
            var pa = treePorts(a, g).length ? 1 : 0, pb = treePorts(b, g).length ? 1 : 0;
            return pb - pa || b.run_time - a.run_time;
          })[0];
          if (keep.pid !== p.pid) {
            var kp = treePorts(keep, g);
            add("duplicate", g, p, [
              "same command and same folder as pid " + keep.pid + (kp.length ? " (which has port :" + kp.join(", :") + ")" : ""),
              "this one has been running for " + age(p.run_time) + ", the other for " + age(keep.run_time)
            ].concat(treePorts(p, g).length ? [] : ["this one has no open ports"]));
            return;
          }
        }

        // 3. Started by this session (a background server, not an MCP).
        if (session && p.claude_pid === session && !mcp) {
          var ports = treePorts(p, g);
          add("session", g, p, [
            "started by this Claude Code session " + age(p.run_time) + " ago",
            ports.length ? "holds port :" + ports.join(", :") + " open" : "no open ports"
          ]);
          return;
        }

        // 4. Idle: old, zero CPU, no port in its tree; not owned by a live session.
        if (!liveOwner && p.run_time >= idleSec && p.cpu < 0.5 && !treePorts(p, g).length) {
          add("idle", g, p, [
            "running for " + age(p.run_time),
            "zero CPU right now",
            "no open ports in its tree"
          ]);
        }
      });
    });

    out.sort(function (a, b) { return CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category); });
    return out;
  }

  var LABELS = {
    "orphan-mcp": "Orphan MCP server",
    "duplicate": "Duplicate",
    "session": "Started by this session",
    "idle": "Idle for a long time"
  };

  return { propose: propose, isMcp: isMcp, inProjects: inProjects, CATEGORIES: CATEGORIES, LABELS: LABELS, IDLE_HOURS: IDLE_HOURS };
});
