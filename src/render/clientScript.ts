/** Inlined city-page script: camera, touch, HUD, infinite tiles, live lots. */

export function mapClientScript(): string {
  return `(function () {
  var svg = document.getElementById("axp-map");
  var card = document.getElementById("lot-card");
  var tag = document.getElementById("hover-tag");
  var hudDistrict = document.getElementById("hud-district");
  var hudCompass = document.getElementById("hud-compass");
  var hudMass = document.getElementById("hud-mass-fill");
  var mini = document.getElementById("hud-mini");
  var hint = document.getElementById("hud-hint");
  if (!svg || !card || !tag) return;

  var plan = { lots: [], bounds: null, features: [] };
  try { plan = JSON.parse(document.getElementById("axp-city-plan").textContent || "{}"); } catch (e) { plan = { lots: [] }; }
  var lots = plan.lots || [];
  var byRepo = {};
  lots.forEach(function (lot) { byRepo[lot.repo] = lot; });

  var base = svg.viewBox.baseVal;
  var home = { x: base.x, y: base.y, w: base.width, h: base.height };
  var view = { x: home.x, y: home.y, w: home.w, h: home.h };
  var tileW = 72, tileH = 36;
  try {
    var tp = (svg.getAttribute("data-tile") || "").split(/\\s+/).map(Number);
    if (tp.length === 2 && tp.every(isFinite)) { tileW = tp[0]; tileH = tp[1]; }
  } catch (e) {}

  function apply() {
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
    paintWild();
    paintMini();
    paintHud();
  }
  function zoomTo(w) {
    view.w = Math.min(Math.max(w, home.w / 16), home.w * 8);
    view.h = view.w * home.h / home.w;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function hideCard() {
    card.hidden = true;
    card.innerHTML = "";
    var prev = svg.querySelector(".lot-hit.selected");
    if (prev) prev.classList.remove("selected");
    if (hudMass) hudMass.style.width = "0%";
  }
  var hoverRepo = null;
  function hideTag() {
    hoverRepo = null;
    tag.hidden = true;
    tag.innerHTML = "";
  }
  function showTag(repo, clientX, clientY) {
    var lot = byRepo[repo];
    var stage = svg.parentElement;
    if (!lot || !stage) { hideTag(); return; }
    var stageBox = stage.getBoundingClientRect();
    if (hoverRepo !== repo) {
      hoverRepo = repo;
      tag.innerHTML =
        '<div class="tag-pop">' +
        '<div class="tag-name">' + esc(lot.repo) + "</div>" +
        '<div class="tag-sub">' + esc(lot.band) + String(lot.id).padStart(2, "0") +
        " · " + esc(lot.yard) + " · " + esc(lot.occupant || "quiet") + "</div>" +
        "</div>";
      tag.hidden = false;
    }
    var x = clientX - stageBox.left;
    var y = clientY - stageBox.top;
    var left = x + 18;
    var top = y - tag.offsetHeight / 2;
    left = Math.min(Math.max(left, 12), stageBox.width - tag.offsetWidth - 12);
    top = Math.min(Math.max(top, 12), stageBox.height - tag.offsetHeight - 12);
    tag.style.left = left + "px";
    tag.style.top = top + "px";
  }
  function massPct(band) {
    return band === "L" ? 100 : band === "M" ? 64 : 34;
  }
  function showCard(repo, hit) {
    var lot = byRepo[repo];
    if (!lot) return;
    svg.querySelectorAll(".lot-hit.selected").forEach(function (el) { el.classList.remove("selected"); });
    if (hit) hit.classList.add("selected");
    var props = lot.props && lot.props.length ? lot.props.join(", ") : "—";
    var occupant = lot.occupant === "robot" ? "ROBOT CREW" : lot.occupant === "human" ? "HUMAN CREW" : "QUIET";
    card.innerHTML =
      '<button class="close" aria-label="Close">×</button>' +
      '<p class="rpg-kicker">' + esc((lot.district || "WARD").toUpperCase()) + " · BUILDING " + esc(lot.band) + "</p>" +
      '<h3><a href="' + esc(lot.url) + '">' + esc(lot.repo) + "</a></h3>" +
      '<div class="rpg-stat"><span>STARS</span><b>' + lot.stars.toLocaleString() + "</b></div>" +
      '<div class="rpg-stat"><span>ISSUES</span><b>' + lot.issues + "</b></div>" +
      '<div class="rpg-stat"><span>PRS</span><b>' + lot.prs + "</b></div>" +
      '<div class="rpg-stat"><span>CREW</span><b>' + esc(occupant) + "</b></div>" +
      "<p>" + esc(lot.yard) + " · " + esc(props) + "</p>" +
      (lot.constructing ? "<p class=\\"rpg-build\\">UNDER CONSTRUCTION</p>" : "");
    card.hidden = false;
    card.querySelector(".close").addEventListener("click", hideCard);
    if (hudMass) hudMass.style.width = massPct(lot.band) + "%";
  }
  var glide = null;
  function stopGlide() { if (glide) { cancelAnimationFrame(glide); glide = null; } }
  function flyTo(cx, cy) {
    stopGlide();
    var x0 = view.x, y0 = view.y;
    var tx = cx - view.w / 2, ty = cy - view.h / 2;
    var t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / 450);
      var e = 1 - Math.pow(1 - k, 3);
      view.x = x0 + (tx - x0) * e;
      view.y = y0 + (ty - y0) * e;
      apply();
      if (k < 1) glide = requestAnimationFrame(step);
      else glide = null;
    }
    glide = requestAnimationFrame(step);
  }
  function centerOn(hit) {
    try {
      var box = hit.getBBox();
      flyTo(box.x + box.width / 2, box.y + box.height / 2);
    } catch (e) {}
  }
  function zoomCenter(f) {
    var cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    zoomTo(view.w * f);
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
  }
  function meetScale() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height || !view.w || !view.h) return 0;
    return Math.min(r.width / view.w, r.height / view.h);
  }
  function toUser(e) {
    var r = svg.getBoundingClientRect();
    var s = meetScale();
    if (!s) return null;
    var ox = r.left + (r.width - view.w * s) / 2;
    var oy = r.top + (r.height - view.h * s) / 2;
    return { x: view.x + (e.clientX - ox) / s, y: view.y + (e.clientY - oy) / s };
  }

  var pointers = {};
  var pinch = null;
  var dragging = false, lx = 0, ly = 0, moved = false;
  function pointerCount() { return Object.keys(pointers).length; }

  svg.addEventListener("pointerdown", function (e) {
    stopGlide();
    hideTag();
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pointerCount() === 2) {
      var ids = Object.keys(pointers);
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        w: view.w,
        cx: view.x + view.w / 2,
        cy: view.y + view.h / 2
      };
      dragging = false;
      return;
    }
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    svg.style.cursor = "grabbing";
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
  });
  svg.addEventListener("pointermove", function (e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch && pointerCount() >= 2) {
      var ids = Object.keys(pointers);
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0 && dist > 0) {
        zoomTo(pinch.w * (pinch.dist / dist));
        view.x = pinch.cx - view.w / 2;
        view.y = pinch.cy - view.h / 2;
        apply();
      }
      return;
    }
    if (dragging) { hideTag(); return; }
    var hit = e.target && e.target.closest ? e.target.closest(".lot-hit") : null;
    if (!hit) { hideTag(); return; }
    showTag(hit.getAttribute("data-repo"), e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", hideTag);
  window.addEventListener("pointermove", function (e) {
    if (!dragging || pinch) return;
    if (!moved && Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) moved = true;
    var s = meetScale();
    if (s) {
      view.x -= (e.clientX - lx) / s;
      view.y -= (e.clientY - ly) / s;
    }
    lx = e.clientX; ly = e.clientY;
    apply();
  });
  function endDrag(e) {
    if (e && e.pointerId != null) delete pointers[e.pointerId];
    if (pointerCount() < 2) pinch = null;
    if (pointerCount() === 0) {
      dragging = false;
      svg.style.cursor = "grab";
    }
  }
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  svg.addEventListener("click", function (e) {
    if (moved) return;
    var hit = e.target && e.target.closest ? e.target.closest(".lot-hit") : null;
    if (!hit) { hideCard(); return; }
    showCard(hit.getAttribute("data-repo"), hit);
    centerOn(hit);
  });
  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    stopGlide();
    var u = toUser(e);
    var mx = u ? u.x : view.x + view.w / 2;
    var my = u ? u.y : view.y + view.h / 2;
    var before = view.w;
    zoomTo(view.w * (e.deltaY > 0 ? 1.15 : 1 / 1.15));
    var k = view.w / before;
    view.x = mx - (mx - view.x) * k;
    view.y = my - (my - view.y) * k;
    apply();
  }, { passive: false });
  svg.addEventListener("dblclick", function () {
    stopGlide();
    view = { x: home.x, y: home.y, w: home.w, h: home.h };
    apply();
    hideCard();
    hideTag();
  });

  function panBy(dx, dy) {
    stopGlide();
    view.x += dx;
    view.y += dy;
    apply();
  }
  document.addEventListener("keydown", function (e) {
    var step = view.w / 8;
    var handled = true;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") panBy(-step, 0);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") panBy(step, 0);
    else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") panBy(0, -step);
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") panBy(0, step);
    else if (e.key === "+" || e.key === "=") { stopGlide(); zoomCenter(1 / 1.25); apply(); }
    else if (e.key === "-" || e.key === "_") { stopGlide(); zoomCenter(1.25); apply(); }
    else if (e.key === "Escape") { hideCard(); hideTag(); }
    else handled = false;
    if (handled) e.preventDefault();
  });

  function bindHold(id, dx, dy) {
    var el = document.getElementById(id);
    if (!el) return;
    var timer = null;
    function tick() { panBy(dx() * view.w / 18, dy() * view.h / 18); }
    function start(ev) {
      ev.preventDefault();
      tick();
      timer = setInterval(tick, 40);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    el.addEventListener("pointerdown", start);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  bindHold("pad-w", function () { return 0; }, function () { return -1; });
  bindHold("pad-s", function () { return 0; }, function () { return 1; });
  bindHold("pad-a", function () { return -1; }, function () { return 0; });
  bindHold("pad-d", function () { return 1; }, function () { return 0; });
  var zIn = document.getElementById("hud-zoom-in");
  var zOut = document.getElementById("hud-zoom-out");
  if (zIn) zIn.addEventListener("click", function () { zoomCenter(1 / 1.25); apply(); });
  if (zOut) zOut.addEventListener("click", function () { zoomCenter(1.25); apply(); });

  function paintHud() {
    if (hudCompass) {
      var ang = Math.atan2(view.y + view.h / 2 - home.y - home.h / 2, view.x + view.w / 2 - home.x - home.w / 2);
      hudCompass.style.transform = "rotate(" + (ang * 180 / Math.PI) + "deg)";
    }
    if (hudDistrict) {
      var cx = view.x + view.w / 2, cy = view.y + view.h / 2;
      var best = "Wilderness", bestD = 1e15;
      lots.forEach(function (lot) {
        var p = worldToScreen(lot.x + 2, lot.y + 1.2);
        var d = Math.hypot(p.sx - cx, p.sy - cy);
        if (d < bestD) { bestD = d; best = lot.district || "Ward"; }
      });
      (plan.features || []).forEach(function (f) {
        var p = worldToScreen(f.x + f.w / 2, f.y + f.h / 2);
        var d = Math.hypot(p.sx - cx, p.sy - cy);
        if (d < bestD) {
          bestD = d;
          best = f.kind === "park" ? "Central Park" : f.kind === "freeway" ? "Freeway" : f.kind === "tram" ? "Tram Line" : f.kind === "river" ? "Riverside" : best;
        }
      });
      hudDistrict.textContent = best.toUpperCase();
    }
    if (hint) {
      hint.textContent = ("ontouchstart" in window)
        ? "drag to pan · pinch to zoom · tap a lot"
        : "WASD / arrows move · scroll zoom · drag pan";
    }
  }
  function worldToScreen(x, y) {
    return { sx: (x - y) * (tileW / 2), sy: (x + y) * (tileH / 2) };
  }
  function paintMini() {
    if (!mini) return;
    var ctx = mini.getContext("2d");
    if (!ctx) return;
    var w = mini.width, h = mini.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(20,24,22,0.72)";
    ctx.fillRect(0, 0, w, h);
    var pts = lots.map(function (lot) { return worldToScreen(lot.x, lot.y); });
    if (!pts.length) return;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    pts.forEach(function (p) {
      minx = Math.min(minx, p.sx); miny = Math.min(miny, p.sy);
      maxx = Math.max(maxx, p.sx); maxy = Math.max(maxy, p.sy);
    });
    minx -= 80; miny -= 80; maxx += 80; maxy += 80;
    var sx = w / Math.max(1, maxx - minx);
    var sy = h / Math.max(1, maxy - miny);
    var sc = Math.min(sx, sy);
    function mx(x) { return (x - minx) * sc; }
    function my(y) { return (y - miny) * sc; }
    (plan.features || []).forEach(function (f) {
      var a = worldToScreen(f.x, f.y);
      var b = worldToScreen(f.x + f.w, f.y + f.h);
      ctx.fillStyle = f.kind === "park" ? "#3d8c4a" : f.kind === "river" ? "#3a7ca5" : f.kind === "freeway" ? "#5a5f66" : "#8a4b20";
      ctx.fillRect(mx(Math.min(a.sx, b.sx)), my(Math.min(a.sy, b.sy)), Math.abs(mx(b.sx) - mx(a.sx)) + 3, Math.abs(my(b.sy) - my(a.sy)) + 3);
    });
    lots.forEach(function (lot, i) {
      var p = pts[i];
      ctx.fillStyle = lot.occupant === "robot" ? "#6ec8ff" : lot.occupant === "human" ? "#f0c14a" : "#9aa3ad";
      ctx.fillRect(mx(p.sx) - 2, my(p.sy) - 2, 4, 4);
    });
    ctx.strokeStyle = "#ffd23f";
    ctx.strokeRect(mx(view.x), my(view.y), view.w * sc, view.h * sc);
  }

  var wild = document.getElementById("infinite-ground");
  var wildKeys = {};
  function paintWild() {
    if (!wild) return;
    var x0 = Math.floor(view.x / tileW) - 2;
    var y0 = Math.floor(view.y / tileH) - 2;
    var x1 = Math.ceil((view.x + view.w) / tileW) + 2;
    var y1 = Math.ceil((view.y + view.h) / tileH) + 2;
    var keep = {};
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        var key = gx + ":" + gy;
        keep[key] = true;
        if (wildKeys[key]) continue;
        var h = Math.imul(gx, 374761393) + Math.imul(gy, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        var u = (h >>> 0) / 4294967296;
        if (u > 0.045) continue;
        var tree = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        tree.setAttribute("cx", String(gx * tileW + tileW / 2));
        tree.setAttribute("cy", String(gy * tileH + tileH / 2));
        tree.setAttribute("rx", u < 0.02 ? "11" : "7");
        tree.setAttribute("ry", u < 0.02 ? "16" : "9");
        tree.setAttribute("fill", u < 0.015 ? "#3f7a3a" : "#5a9a4a");
        tree.setAttribute("opacity", "0.85");
        tree.setAttribute("data-wild", key);
        wild.appendChild(tree);
        wildKeys[key] = tree;
      }
    }
    Object.keys(wildKeys).forEach(function (key) {
      if (keep[key]) return;
      wildKeys[key].remove();
      delete wildKeys[key];
    });
  }

  function spawnAir() {
    var layer = document.getElementById("air-layer");
    if (!layer) return;
    var kinds = ["bird", "liner", "starlink", "cloud"];
    var kind = kinds[Math.floor(Math.random() * kinds.length)];
    var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "air-spawn air-" + kind);
    var y = view.y + 10 + Math.random() * 80;
    var x = view.x - 20;
    if (kind === "bird") {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", "M0 0 q6 -4 10 0 q-4 -1 -5 -4 q-1 3 -5 4");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "#2b2f36");
      p.setAttribute("stroke-width", "1.4");
      g.appendChild(p);
    } else if (kind === "liner") {
      var body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      body.setAttribute("x", "-10"); body.setAttribute("y", "-3");
      body.setAttribute("width", "28"); body.setAttribute("height", "6");
      body.setAttribute("rx", "2"); body.setAttribute("fill", "#eef2f6");
      g.appendChild(body);
    } else if (kind === "starlink") {
      for (var i = 0; i < 8; i++) {
        var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", String(-i * 12));
        c.setAttribute("cy", "0");
        c.setAttribute("r", "1.2");
        c.setAttribute("fill", "#dce7ff");
        g.appendChild(c);
      }
    } else {
      var cl = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      cl.setAttribute("rx", "34"); cl.setAttribute("ry", "12");
      cl.setAttribute("fill", "#f5f7fa"); cl.setAttribute("opacity", "0.5");
      g.appendChild(cl);
    }
    g.setAttribute("transform", "translate(" + x + " " + y + ")");
    layer.appendChild(g);
    var t0 = performance.now();
    var span = view.w + 80;
    function fly(now) {
      var k = Math.min(1, (now - t0) / (kind === "liner" ? 18000 : 9000));
      g.setAttribute("transform", "translate(" + (x + span * k) + " " + (y + 10 * k) + ")");
      if (k < 1) requestAnimationFrame(fly);
      else g.remove();
    }
    requestAnimationFrame(fly);
  }
  setInterval(spawnAir, 7000);

  function attachLive() {
    if (typeof EventSource === "undefined") return;
    var src;
    try { src = new EventSource("/api/city/stream"); }
    catch (e) { return; }
    src.addEventListener("lot_added", function (ev) {
      var payload;
      try { payload = JSON.parse(ev.data); } catch (err) { return; }
      if (!payload || !payload.lot) return;
      var lot = payload.lot;
      if (byRepo[lot.repo]) return;
      lots.push(lot);
      byRepo[lot.repo] = lot;
      if (payload.svg) {
        var items = document.getElementById("city-items");
        var hits = svg.querySelector(".hits");
        if (items) {
          var wrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
          wrap.innerHTML = payload.svg;
          while (wrap.firstChild) items.appendChild(wrap.firstChild);
        }
        if (hits && payload.hit) {
          var hw = document.createElementNS("http://www.w3.org/2000/svg", "g");
          hw.innerHTML = payload.hit;
          while (hw.firstChild) hits.appendChild(hw.firstChild);
        }
      }
      var toast = document.getElementById("hud-toast");
      if (toast) {
        toast.textContent = "NEW PLOT · " + lot.repo;
        toast.hidden = false;
        setTimeout(function () { toast.hidden = true; }, 4000);
      }
      paintMini();
    });
  }
  attachLive();
  apply();
})();`;
}
