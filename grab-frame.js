/* Jellyfin web-player add-ons, injected into the player's bottom control bar:
   - photo_camera  -> saves a full-resolution PNG via the local screenshot service
   - navigate_before / navigate_next -> frame-by-frame step (also keyboard , and .)
   Steps use the item's real frame rate so one step ~= one frame. */
(function () {
  var PORT = 9009;
  var TOKEN = "REPLACE_WITH_YOUR_OWN_SHARED_TOKEN"; // must match server.py
  var fpsCache = { id: null, val: 0 };

  /* ---- native-style OSD icon button ---- */
  function mkIconBtn(id, icon, title, role) {
    var b = document.createElement("button");
    b.id = id;
    b.dataset.jfgrab = role; // role tag survives icon changes (hourglass/check/error)
    b.setAttribute("is", "paper-icon-button-light");
    b.className = "autoSize paper-icon-button-light";
    b.title = title;
    var span = document.createElement("span");
    span.className = "xlargePaperIconButton material-icons " + icon;
    span.setAttribute("aria-hidden", "true");
    span.textContent = ""; // glyph comes from the class (::before), like native buttons
    b.appendChild(span);
    return b;
  }
  function setIcon(btn, icon) {
    var s = btn.querySelector("span");
    s.className = "xlargePaperIconButton material-icons " + icon;
    s.textContent = "";
  }

  /* pick the OSD button row that is actually on screen right now */
  function visibleHost() {
    var rows = document.querySelectorAll(".videoOsdBottom .buttons.focuscontainer-x");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].offsetParent !== null) return rows[i].querySelector("div") || rows[i];
    }
    return null;
  }

  /* Collapse our buttons to a global singleton per role, living in `host`.
     Returns a map of the survivors so the caller can fill in any missing roles.
     This is keyed on the data-jfgrab tag (not the icon id/glyph), so a button
     whose icon is mid-flash (hourglass/check/error) is still recognised as ours
     and de-duplicated correctly. */
  function dedupe(host) {
    document.getElementById("jfGrabBar") && document.getElementById("jfGrabBar").remove();
    document.getElementById("grabFrameBtn") && document.getElementById("grabFrameBtn").remove();
    var have = {};
    ["prev", "cam", "next"].forEach(function (role) {
      document.querySelectorAll('[data-jfgrab="' + role + '"]').forEach(function (el) {
        if (have[role]) { el.remove(); return; } // keep the first, drop the rest
        if (el.parentNode !== host) host.appendChild(el); // pull keeper into the visible row
        have[role] = el;
      });
    });
    // any camera glyph that ISN'T tagged by us is a stray (old version) -> remove it
    document.querySelectorAll(".material-icons.photo_camera").forEach(function (span) {
      var btn = span.closest("button");
      if (btn && !btn.dataset.jfgrab) btn.remove();
    });
    return have;
  }

  /* keep exactly one set of buttons inside the visible OSD button row */
  function ensureOsdButtons() {
    var host = visibleHost();
    if (!host) return;
    var have = dedupe(host);
    if (!have.prev) {
      var prev = mkIconBtn("jfStepPrev", "navigate_before", "Previous frame ( , )", "prev");
      prev.addEventListener("click", function (e) { e.stopPropagation(); stepFrame(-1); });
      host.appendChild(prev);
    }
    if (!have.cam) {
      var cam = mkIconBtn("jfGrabCam", "photo_camera", "Save full-resolution frame", "cam");
      cam.addEventListener("click", function (e) { e.stopPropagation(); grab(); });
      host.appendChild(cam);
    }
    if (!have.next) {
      var next = mkIconBtn("jfStepNext", "navigate_next", "Next frame ( . )", "next");
      next.addEventListener("click", function (e) { e.stopPropagation(); stepFrame(1); });
      host.appendChild(next);
    }
  }

  function videoEl() {
    var v = document.querySelector("video");
    return v && v.offsetParent !== null && v.currentTime > 0 ? v : null;
  }

  async function currentItemId() {
    try {
      var api = window.ApiClient;
      var sessions = await api.getSessions({});
      var me = sessions.find(function (s) { return s.DeviceId === api.deviceId(); });
      return me && me.NowPlayingItem && me.NowPlayingItem.Id;
    } catch (e) { return null; }
  }

  async function getFps() {
    var id = await currentItemId();
    if (!id) return fpsCache.val || 25;
    if (fpsCache.id === id && fpsCache.val) return fpsCache.val;
    try {
      var api = window.ApiClient;
      var url = api.serverAddress() + "/Items?ids=" + encodeURIComponent(id) +
        "&fields=MediaSources&api_key=" + api.accessToken();
      var data = await (await fetch(url)).json();
      var streams = data.Items[0].MediaSources[0].MediaStreams;
      var vid = streams.find(function (s) { return s.Type === "Video"; });
      var fps = parseFloat(vid.RealFrameRate || vid.AverageFrameRate) || 25;
      fpsCache = { id: id, val: fps };
      return fps;
    } catch (e) { return fpsCache.val || 25; }
  }

  async function stepFrame(dir) {
    var v = document.querySelector("video");
    if (!v) return;
    try { v.pause(); } catch (e) {}
    var fps = await getFps();
    var max = v.duration && isFinite(v.duration) ? v.duration : 1e9;
    v.currentTime = Math.min(max, Math.max(0, v.currentTime + dir * (1 / fps)));
  }

  async function grab() {
    var cam = document.getElementById("jfGrabCam");
    var v = document.querySelector("video");
    if (!v) return;
    var t = v.currentTime;
    var itemId = await currentItemId();
    if (!itemId) { if (cam) flashIcon(cam, "error"); return; }
    var url = location.protocol + "//" + location.hostname + ":" + PORT +
      "/grab?id=" + encodeURIComponent(itemId) + "&t=" + t + "&k=" + TOKEN;
    if (cam) setIcon(cam, "hourglass_empty");
    try {
      var resp = await fetch(url);
      if (!resp.ok) throw new Error(await resp.text());
      var blob = await resp.blob();
      var name = itemId + "_" + Math.floor(t) + ".png";
      var cd = resp.headers.get("Content-Disposition");
      if (cd) { var m = /filename="?([^"]+)"?/.exec(cd); if (m) name = m[1]; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      if (cam) flashIcon(cam, "check");
    } catch (e) {
      console.error("grab-frame:", e);
      if (cam) flashIcon(cam, "error");
    }
  }

  function flashIcon(btn, icon) {
    setIcon(btn, icon);
    setTimeout(function () { setIcon(btn, "photo_camera"); }, 1500);
  }

  /* keyboard: , = previous frame, . = next frame (capture phase to beat Jellyfin) */
  document.addEventListener("keydown", function (e) {
    if (!videoEl()) return;
    var t = (e.target.tagName || "").toLowerCase();
    if (t === "input" || t === "textarea" || e.target.isContentEditable) return;
    if (e.key === ",") { e.preventDefault(); e.stopPropagation(); stepFrame(-1); }
    else if (e.key === ".") { e.preventDefault(); e.stopPropagation(); stepFrame(1); }
  }, true);

  setInterval(function () {
    if (videoEl()) { ensureOsdButtons(); getFps(); /* warm cache */ }
  }, 600);
})();
