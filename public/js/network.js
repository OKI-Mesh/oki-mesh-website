// OKIMesh live network graph — D3 force-directed.
// Reads CoreScope neighbor-graph; falls back to baked data/network.json (via data-fallback attr).
(function () {
  const mount = document.getElementById("netgraph");
  if (!mount) return;

  const BASE = mount.dataset.base;
  const API  = BASE + "/api/analytics/neighbor-graph";
  const STATS_API = BASE + "/api/stats";
  const HERO_LIMIT = 42;
  const PAD = 12;

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  async function load() {
    for (const url of [API, FALLBACK].filter(Boolean)) {
      try {
        const r = await fetch(url, { mode: "cors" });
        if (!r.ok) continue;
        return await r.json();
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async function loadStats() {
    const r = await fetch(STATS_API, { mode: "cors" });
    if (!r.ok) throw new Error("stats fetch failed");
    return await r.json();
  }

  function clean(data) {
    const nodes = (data.nodes || []).filter(n => n.pubkey);
    const pk = new Set(nodes.map(n => n.pubkey));
    const edges = (data.edges || []).filter(e =>
      !e.ambiguous && pk.has(e.source) && pk.has(e.target)
    );
    return { nodes, edges };
  }

  function curate(nodes, edges, limit) {
    const ranked = [...nodes].sort((a, b) => (b.neighbor_count || 0) - (a.neighbor_count || 0));
    const keep = new Set(ranked.slice(0, limit).map(n => n.pubkey));
    const n2 = nodes.filter(n => keep.has(n.pubkey));
    const e2 = edges.filter(e => keep.has(e.source) && keep.has(e.target));
    return { nodes: n2, edges: e2 };
  }

  function roleColor(role) {
    if (role === "repeater") return cssVar("--color-signal");
    if (role === "room") return cssVar("--color-amber");
    return cssVar("--color-signal-dim");
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function render(graph) {
    const isHero = MODE === "hero";
    const W = isHero ? 400 : 1000;
    const H = isHero ? 400 : 680;
    const PAD = 6;

    const svg = d3.select(mount).append("svg")
      .attr("viewBox", [0, 0, W, H])
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%").attr("height", "100%");

    const g = svg.append("g");

    const link = g.append("g").attr("stroke-linecap", "round")
      .selectAll("line").data(graph.edges).join("line")
      .attr("stroke", cssVar("--color-signal-dim"))
      .attr("stroke-opacity", d => 0.15 + 0.55 * (d.score || 0))
      .attr("stroke-width", d => 0.4 + 1.8 * (d.score || 0));

    const r = d => isHero ? 3 + Math.min(7, (d.neighbor_count || 1) * 0.5)
                          : 2.5 + Math.min(9, (d.neighbor_count || 1) * 0.45);

    const node = g.append("g")
      .selectAll("circle").data(graph.nodes).join("circle")
      .attr("r", r)
      .attr("fill", d => roleColor(d.role))
      .attr("stroke", cssVar("--color-bg"))
      .attr("stroke-width", 1)
      .style("cursor", isHero ? "default" : "pointer");

    if (!isHero) {
      const tip = d3.select(mount).append("div").attr("class", "net-tip");
      node.on("mousemove", (ev, d) => {
        tip.style("opacity", 1)
           .style("left", (ev.offsetX + 14) + "px")
           .style("top", (ev.offsetY + 10) + "px")
           .html(`<b>${d.name || "(unnamed)"}</b><span>${d.role || "node"} · ${d.neighbor_count || 0} links</span>`);
      }).on("mouseleave", () => tip.style("opacity", 0));
    }

const sim = d3.forceSimulation(graph.nodes)
  .force("link", d3.forceLink(graph.edges).id(d => d.pubkey)
    .distance(d => isHero ? 50 : 36).strength(d => 0.05 + 0.4 * (d.score || 0)))
  .force("charge", d3.forceManyBody().strength(isHero ? -80 : -30))
  .force("center", d3.forceCenter(W / 2, H / 2))
  .force("x", d3.forceX(W / 2).strength(0.08))
  .force("y", d3.forceY(H / 2).strength(0.08))
  .force("collide", d3.forceCollide().radius(d => r(d) + 2));
    sim.on("tick", () => {
      graph.nodes.forEach(d => {
        const rad = r(d) + PAD;
        d.x = Math.max(rad, Math.min(W - rad, d.x));
        d.y = Math.max(rad, Math.min(H - rad, d.y));
      });
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("cx", d => d.x).attr("cy", d => d.y);
    });

    if (!isHero) {
      svg.call(d3.zoom().scaleExtent([0.3, 6]).on("zoom", ev => g.attr("transform", ev.transform)));
      node.call(d3.drag()
        .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (ev, d) => {
          const rad = r(d) + PAD;
          d.fx = Math.max(rad, Math.min(W - rad, ev.x));
          d.fy = Math.max(rad, Math.min(H - rad, ev.y));
        })
        .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    } else {
      svg.style("pointer-events", "none");
    }

    setEl("net-stat", `${graph.nodes.length} nodes · ${graph.edges.length} links`);
  }

  load().then(data => {
    if (!data) { mount.innerHTML = '<div class="net-err">network data unavailable</div>'; return; }
    let graph = clean(data);
    if (MODE === "hero") graph = curate(graph.nodes, graph.edges, HERO_LIMIT);
    render(graph);
  });

  loadStats().then(d => {
    setEl("sl-nodes",      d.totalNodes.toLocaleString());
    setEl("sl-repeaters",  d.counts.repeaters.toLocaleString());
    setEl("sl-rooms",      d.counts.rooms.toLocaleString());
    setEl("sl-companions", d.counts.companions.toLocaleString());
    setEl("sl-pkt-1h",     d.packetsLastHour.toLocaleString());
    setEl("sl-pkt-24h",    d.packetsLast24h.toLocaleString());
    setEl("sl-obs",        d.totalObservations.toLocaleString());
    setEl("sl-version",    d.version);
  });

})();