/* Jellyfin web add-on: show a quality/size badge on every poster card and list row.
   e.g. "4K · 17.4 GB" — so duplicate titles are instantly comparable.
   Disable at runtime with: localStorage.jfCardQuality = "off"  (then refresh). */
(function () {
  if (localStorage.getItem("jfCardQuality") === "off") return;

  var CLS = "jfQualBadge";
  var cache = new Map();          // itemId -> {label:string} | {label:null} (no media)
  var pending = new Set();        // ids currently being fetched
  var scanTimer = null;

  /* ---------- formatting ---------- */
  /* decimal GB, so the number matches Finder / Google Drive */
  function fmtSize(bytes) {
    if (!bytes) return null;
    var gb = bytes / 1e9;
    if (gb >= 1) return (gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)) + " GB";
    return Math.round(bytes / 1e6) + " MB";
  }
  function fmtRes(w, h) {
    if (!h) return null;
    if (h >= 2000 || w >= 3000) return "4K";
    if (h >= 1400 || w >= 2000) return "1440p";
    if (h >= 900) return "1080p";
    if (h >= 700) return "720p";
    if (h >= 500) return "576p";
    return h + "p";
  }
  function infoFor(item) {
    var ms = (item.MediaSources || [])[0];
    if (!ms) return { label: null };
    var vid = (ms.MediaStreams || []).filter(function (s) { return s.Type === "Video"; })[0] || {};
    var parts = [];
    var res = fmtRes(vid.Width || item.Width, vid.Height || item.Height);
    if (res) parts.push(res);
    var sz = fmtSize(ms.Size);
    if (sz) parts.push(sz);
    /* tooltip: the bit that actually tells two same-size copies apart */
    var tip = [];
    if (ms.Path) tip.push(ms.Path);
    var meta = [];
    if (vid.Width && vid.Height) meta.push(vid.Width + "x" + vid.Height);
    if (vid.Codec) meta.push(String(vid.Codec).toUpperCase());
    if (ms.Bitrate) meta.push(Math.round(ms.Bitrate / 1e6) + " Mbps");
    if (meta.length) tip.push(meta.join("  \u00b7  "));
    return { label: parts.length ? parts.join(" \u00b7 ") : null, tip: tip.join("\n") };
  }

  /* ---------- data ---------- */
  async function fetchInfo(ids) {
    var api = window.ApiClient;
    if (!api || !api.accessToken()) return;
    var url = api.serverAddress() + "/Items?ids=" + ids.join(",") +
      "&fields=MediaSources&api_key=" + api.accessToken();
    var data = await (await fetch(url)).json();
    (data.Items || []).forEach(function (it) { cache.set(it.Id, infoFor(it)); });
    // anything the server didn't return (folders, people, live tv) -> remember as blank
    ids.forEach(function (id) { if (!cache.has(id)) cache.set(id, { label: null }); });
  }

  /* ---------- painting ---------- */
  var SKIP = { Series: 1, Season: 1, BoxSet: 1, Person: 1, MusicArtist: 1, MusicAlbum: 1,
               Playlist: 1, CollectionFolder: 1, UserView: 1, Genre: 1, Studio: 1 };

  function targets() {
    return document.querySelectorAll(
      ".card[data-id]:not([data-jfqual]), .listItem[data-id]:not([data-jfqual])");
  }

  function paint(el, info) {
    var label = info && info.label;
    el.setAttribute("data-jfqual", label ? "1" : "0");
    if (!label) return;
    var badge = document.createElement("div");
    badge.className = CLS;
    badge.textContent = label;
    if (info.tip) badge.title = info.tip;
    if (el.classList.contains("card")) {
      var host = el.querySelector(".cardScalable") || el.querySelector(".cardBox") || el;
      host.style.position = host.style.position || "relative";
      host.appendChild(badge);
    } else {
      badge.classList.add(CLS + "-inline");
      var body = el.querySelector(".listItemBodyText") || el.querySelector(".listItemBody") || el;
      body.appendChild(badge);
    }
  }

  function scan() {
    var els = targets();
    if (!els.length) return;
    var need = [];
    els.forEach(function (el) {
      var id = el.getAttribute("data-id");
      var type = el.getAttribute("data-type");
      if (!id || (type && SKIP[type]) || el.getAttribute("data-isfolder") === "true") {
        el.setAttribute("data-jfqual", "0"); return;
      }
      if (cache.has(id)) { paint(el, cache.get(id)); return; }
      if (!pending.has(id)) { pending.add(id); need.push(id); }
    });
    if (!need.length) return;
    for (var i = 0; i < need.length; i += 50) {
      (function (batch) {
        fetchInfo(batch)
          .catch(function () { batch.forEach(function (id) { cache.set(id, { label: null }); }); })
          .then(function () {
            batch.forEach(function (id) { pending.delete(id); });
            document.querySelectorAll("[data-id]:not([data-jfqual])").forEach(function (el) {
              var id = el.getAttribute("data-id");
              if (cache.has(id) && (el.classList.contains("card") || el.classList.contains("listItem"))) {
                paint(el, cache.get(id));
              }
            });
          });
      })(need.slice(i, i + 50));
    }
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  /* ---------- styles ---------- */
  var css = document.createElement("style");
  css.textContent =
    "." + CLS + "{position:absolute;left:.4em;bottom:.4em;z-index:2;cursor:default;" +
    "background:rgba(0,0,0,.78);color:#fff;font-size:.78em;font-weight:500;line-height:1;" +
    "padding:.32em .5em;border-radius:.28em;letter-spacing:.02em;white-space:nowrap;" +
    "text-shadow:none;max-width:calc(100% - .8em);overflow:hidden;text-overflow:ellipsis}" +
    "." + CLS + "-inline{position:static;display:inline-block;margin-top:.25em;background:rgba(255,255,255,.14)}";
  document.head.appendChild(css);

  /* ---------- run ---------- */
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("viewshow", schedule);
  window.addEventListener("hashchange", schedule);
  setInterval(schedule, 2000);   // catches lazy/virtual scroll re-use
  schedule();
})();
