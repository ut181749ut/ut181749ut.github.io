/* 一言日記 — 1日1行、30秒で終わる日記
 * 保存先: この端末の IndexedDB（サーバーは使わない）
 */
(function () {
  "use strict";

  const CFG = window.HITOKOTO_CONFIG || {};
  // スマホアプリ（Capacitor）の中で動いているか
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const MAX = 50;
  const WD = "日月火水木金土";
  const $ = (id) => document.getElementById(id);

  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const fmtLong = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;

  function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // =========================================================
  // 保存（IndexedDB）
  // =========================================================
  const DB_NAME = "hitokoto", STORE = "entries";
  let idb = null;
  let entries = {}; // "YYYY-MM-DD" -> { day, text, photo: Blob|null, updatedAt }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "day" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbRun(mode, fn) {
    return new Promise((resolve, reject) => {
      if (!idb) return resolve(null);
      const tx = idb.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function loadAll() {
    try {
      idb = await openDB();
      const all = (await idbRun("readonly", (s) => s.getAll())) || [];
      all.forEach((r) => { entries[r.day] = r; });
    } catch (e) {
      idb = null;
      toast("この端末では保存できません（閉じると消えます）");
    }
  }
  async function setEntry(day, text, photo) {
    text = (text || "").trim().slice(0, MAX);
    try {
      if (!text && !photo) {
        delete entries[day];
        await idbRun("readwrite", (s) => s.delete(day));
      } else {
        const rec = { day, text, photo: photo || null, updatedAt: new Date().toISOString() };
        entries[day] = rec;
        await idbRun("readwrite", (s) => s.put(rec));
      }
    } catch (e) {
      toast("保存できませんでした。端末の空き容量を確認してください");
      throw e;
    }
  }

  // 写真の表示用URL（Blobごとに1つ作って使い回す）
  const urlCache = new Map(); // day -> { blob, url }
  function photoURL(day) {
    const rec = entries[day];
    const blob = rec && rec.photo;
    const c = urlCache.get(day);
    if (c && c.blob === blob) return c.url;
    if (c) URL.revokeObjectURL(c.url);
    if (!blob) { urlCache.delete(day); return null; }
    const url = URL.createObjectURL(blob);
    urlCache.set(day, { blob, url });
    return url;
  }

  // 写真を縮小（長い辺 1280px の JPEG）して保存容量を抑える
  async function shrinkImage(file) {
    const LONG = 1280;
    let src, w, h;
    try {
      src = await createImageBitmap(file, { imageOrientation: "from-image" });
      w = src.width; h = src.height;
    } catch (e) {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        const u = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("image")); };
        img.src = u;
      });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const s = Math.min(1, LONG / Math.max(w, h));
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
    if (src.close) src.close();
    return await new Promise((resolve) => cv.toBlob(resolve, "image/jpeg", 0.82));
  }

  // =========================================================
  // 計算
  // =========================================================
  function streakUntil(t) {
    const d = new Date(t);
    if (!entries[keyOf(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (entries[keyOf(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function sameDayPast(t) {
    const tk = keyOf(t), mmdd = tk.slice(5);
    return Object.keys(entries).filter((k) => k.slice(5) === mmdd && k < tk).sort().reverse();
  }
  function yearData(y) {
    const keys = Object.keys(entries).filter((k) => k.startsWith(y + "-")).sort();
    let best = 0, run = 0;
    const d = new Date(y, 0, 1);
    while (d.getFullYear() === y) {
      if (entries[keyOf(d)]) { run++; best = Math.max(best, run); } else run = 0;
      d.setDate(d.getDate() + 1);
    }
    const photos = keys.filter((k) => entries[k].photo).length;
    const months = {};
    keys.forEach((k) => { const m = Number(k.slice(5, 7)); (months[m] = months[m] || []).push(k); });
    return { keys, best, photos, months };
  }

  // =========================================================
  // 入力欄（ホームと日付シートで共通）
  // =========================================================
  class Editor {
    constructor(root, onSaved) {
      this.root = root;
      this.onSaved = onSaved;
      this.text = root.querySelector(".e-text");
      this.file = root.querySelector(".e-file");
      this.preview = root.querySelector(".e-preview");
      this.previewImg = this.preview.querySelector("img");
      this.count = root.querySelector(".e-count");
      this.saveBtn = root.querySelector(".e-save");
      this.photoLabel = root.querySelector(".e-photo-label");
      this.key = null;
      this.draftPhoto = undefined; // undefined: 変更なし / null: はずした / Blob: 新しい写真
      this.draftURL = null;
      this.dirty = false;

      this.text.addEventListener("input", () => this.refresh());
      this.text.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); this.save(); }
      });
      this.saveBtn.addEventListener("click", () => this.save());
      this.file.addEventListener("change", async () => {
        const f = this.file.files && this.file.files[0];
        this.file.value = "";
        if (!f) return;
        try { this.setDraftPhoto(await shrinkImage(f)); }
        catch (e) { toast("この写真は読み込めませんでした"); }
      });
      this.preview.querySelector(".remove").addEventListener("click", () => this.setDraftPhoto(null));
    }
    load(key, force) {
      if (!force && key === this.key && this.dirty) { this.refresh(); return; }
      this.key = key;
      this.text.value = (entries[key] && entries[key].text) || "";
      this.setDraftPhoto(undefined, true);
    }
    setDraftPhoto(p, silent) {
      if (this.draftURL) { URL.revokeObjectURL(this.draftURL); this.draftURL = null; }
      this.draftPhoto = p;
      if (p) this.draftURL = URL.createObjectURL(p);
      this.refresh(silent);
    }
    photo() {
      if (this.draftPhoto !== undefined) return this.draftPhoto;
      return (entries[this.key] && entries[this.key].photo) || null;
    }
    refresh() {
      const saved = entries[this.key];
      const textChanged = this.text.value.trim() !== ((saved && saved.text) || "");
      this.dirty = textChanged || this.draftPhoto !== undefined;

      const n = this.text.value.length;
      this.count.textContent = `${n} / ${MAX}`;
      this.count.classList.toggle("near", n >= MAX - 5);

      const p = this.photo();
      const url = this.draftPhoto ? this.draftURL : (p ? photoURL(this.key) : null);
      this.preview.hidden = !url;
      if (url) this.previewImg.src = url;
      this.photoLabel.textContent = p ? "写真を変える" : "写真";

      const isSaved = !this.dirty && !!saved;
      this.saveBtn.textContent = isSaved ? "保存済み" : "保存";
      this.saveBtn.classList.toggle("saved", isSaved);
    }
    async save() {
      if (!this.key) return;
      if (!this.dirty && entries[this.key]) return;
      const had = !!entries[this.key];
      try { await setEntry(this.key, this.text.value, this.photo()); } catch (e) { return; }
      this.setDraftPhoto(undefined, true);
      this.text.blur();
      toast(entries[this.key] ? "保存しました" : (had ? "消しました" : "まだ何も書いていません"));
      this.onSaved && this.onSaved();
    }
  }

  // =========================================================
  // ホーム
  // =========================================================
  let shownDay = keyOf(today());
  const homeEditor = new Editor($("homeEditor"), () => render());

  function renderHome() {
    const t = today(), tk = keyOf(t);
    const dayChanged = tk !== shownDay;
    shownDay = tk;
    $("date").innerHTML = `${t.getMonth() + 1}月${t.getDate()}日<small>（${WD[t.getDay()]}）</small>`;

    const total = Object.keys(entries).length;
    $("stats").innerHTML = total === 0
      ? "最初の一言を書いてみましょう"
      : `連続 <b>${streakUntil(t)}</b>日 ・ これまで ${total}日`;

    homeEditor.load(tk, dayChanged);

    const box = $("past");
    box.innerHTML = "";
    const past = sameDayPast(t);
    if (!past.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "1年続けると、ここに「去年の今日」の一言が出てきます。";
      box.appendChild(e);
    }
    past.forEach((k) => {
      const d = parseKey(k), rec = entries[k];
      const c = document.createElement("div");
      c.className = "past-card";
      const w = document.createElement("div");
      w.className = "when";
      w.textContent = `${t.getFullYear() - d.getFullYear()}年前（${d.getFullYear()}年）`;
      c.appendChild(w);
      if (rec.text) {
        const tx = document.createElement("div");
        tx.className = "text hand";
        tx.textContent = rec.text;
        c.appendChild(tx);
      }
      const u = photoURL(k);
      if (u) { const im = document.createElement("img"); im.src = u; im.alt = ""; c.appendChild(im); }
      box.appendChild(c);
    });
  }

  // =========================================================
  // カレンダー
  // =========================================================
  let calY, calM;
  function renderCal() {
    const t = today();
    $("month").textContent = `${calY}年${calM + 1}月`;
    $("next").disabled = calY === t.getFullYear() && calM === t.getMonth();

    const grid = $("grid");
    grid.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const w = document.createElement("div");
      w.className = "wk" + (i === 0 ? " sun" : "");
      w.textContent = WD[i];
      grid.appendChild(w);
    }
    const first = new Date(calY, calM, 1).getDay();
    const days = new Date(calY, calM + 1, 0).getDate();
    for (let i = 0; i < first; i++) {
      const b = document.createElement("div"); b.className = "day blank"; grid.appendChild(b);
    }
    let written = 0;
    for (let d = 1; d <= days; d++) {
      const date = new Date(calY, calM, d), k = keyOf(date);
      const b = document.createElement("button");
      b.className = "day";
      const s = document.createElement("span");
      s.textContent = d;
      b.appendChild(s);
      if (entries[k]) {
        written++;
        b.classList.add("w");
        const u = photoURL(k);
        if (u) { b.classList.add("ph"); b.style.backgroundImage = `url("${u}")`; }
      }
      if (k === keyOf(t)) b.classList.add("today");
      if (date > t) { b.classList.add("future"); b.disabled = true; }
      else b.addEventListener("click", () => openDay(k));
      grid.appendChild(b);
    }
    $("calSum").textContent = `この月は ${written}日 書きました`;
  }
  $("prev").addEventListener("click", () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCal(); });
  $("next").addEventListener("click", () => {
    const t = today();
    if (calY === t.getFullYear() && calM === t.getMonth()) return;
    calM++; if (calM > 11) { calM = 0; calY++; }
    renderCal();
  });
  $("copyAll").addEventListener("click", async () => {
    const keys = Object.keys(entries).sort();
    if (!keys.length) { toast("まだ一言がありません"); return; }
    const text = keys.map((k) => `${k}  ${entries[k].text || "（写真のみ）"}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`${keys.length}日分をコピーしました`); }
    catch (e) { toast("コピーできませんでした"); }
  });

  // =========================================================
  // 日付シート
  // =========================================================
  let dayKey = null;
  const dayEditor = new Editor($("dayEditor"), () => { showDayView(); render(); });

  function openDay(k) {
    dayKey = k;
    $("dayTitle").textContent = fmtLong(parseKey(k));
    showDayView();
    $("dayOverlay").classList.add("open");
  }
  function showDayView() {
    const rec = entries[dayKey];
    const el = $("dayText");
    el.textContent = (rec && rec.text) || (rec ? "" : "この日は書いていません");
    el.classList.toggle("none", !rec);
    const u = rec ? photoURL(dayKey) : null;
    $("dayPhoto").hidden = !u;
    if (u) $("dayPhoto").src = u;
    $("dayEdit").textContent = rec ? "書き直す" : "書く";
    $("dayView").hidden = false;
    $("dayEditor").hidden = true;
  }
  function closeDay() { $("dayOverlay").classList.remove("open"); dayKey = null; }
  $("dayClose").addEventListener("click", closeDay);
  $("dayCancel").addEventListener("click", showDayView);
  $("dayEdit").addEventListener("click", () => {
    dayEditor.load(dayKey, true);
    $("dayView").hidden = true;
    $("dayEditor").hidden = false;
    dayEditor.text.focus();
  });

  // =========================================================
  // 設定・テーマ
  // =========================================================
  const THEMES = [
    { id: "kinari", name: "生成り", bg: "#FAF7F2", accent: "#D9694A" },
    { id: "yoru",   name: "夜",     bg: "#1E1D22", accent: "#F0A46B" },
    { id: "sakura", name: "桜",     bg: "#FBF3F4", accent: "#D46A86" },
    { id: "wakaba", name: "若葉",   bg: "#F4F7F0", accent: "#5E9B4F" },
    { id: "umi",    name: "海",     bg: "#F1F5F8", accent: "#3C7FB0" },
  ];
  function applyTheme(id) {
    const th = THEMES.find((x) => x.id === id) || THEMES[0];
    document.documentElement.dataset.theme = th.id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = th.bg;
    lsSet("hitokoto.theme", th.id);
    document.querySelectorAll(".theme").forEach((b) => b.classList.toggle("on", b.dataset.id === th.id));
  }
  function buildThemes() {
    const box = $("themes");
    THEMES.forEach((th) => {
      const b = document.createElement("button");
      b.className = "theme";
      b.dataset.id = th.id;
      b.innerHTML = `<span class="sw" style="background:${th.bg};--sw-accent:${th.accent}"></span>${th.name}`;
      b.addEventListener("click", () => applyTheme(th.id));
      box.appendChild(b);
    });
  }
  $("openSettings").addEventListener("click", () => { updateProBadge(); $("setOverlay").classList.add("open"); });
  $("setClose").addEventListener("click", () => $("setOverlay").classList.remove("open"));
  $("toSummary").addEventListener("click", () => { $("setOverlay").classList.remove("open"); go("summary"); });

  // シートの外側を押すと閉じる / Escで閉じる
  ["dayOverlay", "setOverlay"].forEach((id) => {
    $(id).addEventListener("click", (e) => { if (e.target.id === id) { $(id).classList.remove("open"); if (id === "dayOverlay") dayKey = null; } });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDay(); $("setOverlay").classList.remove("open"); }
  });

  // =========================================================
  // 有料機能（1年のまとめ）
  // =========================================================
  const isPro = () => lsGet("hitokoto.pro", "") === "1";
  function updateProBadge() {
    const b = $("proBadge");
    b.textContent = isPro() ? "購入済み" : "有料";
    b.classList.toggle("got", isPro());
  }
  async function sha256(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function tryUnlock(code) {
    code = (code || "").trim().toUpperCase();
    if (!code || !CFG.unlockCodeSha256 || !(window.crypto && crypto.subtle)) return false;
    if ((await sha256(code)) !== CFG.unlockCodeSha256) return false;
    lsSet("hitokoto.pro", "1");
    return true;
  }
  $("codeBtn").addEventListener("click", async () => {
    if (await tryUnlock($("codeInput").value)) { toast("1年のまとめが使えるようになりました"); renderSummary(); }
    else toast("コードが違うようです");
  });
  $("buyBtn").addEventListener("click", (e) => {
    if (!CFG.paymentUrl) { e.preventDefault(); toast("購入はただいま準備中です"); }
  });

  let sumYear = today().getFullYear();
  function renderSummary() {
    const years = new Set(Object.keys(entries).map((k) => Number(k.slice(0, 4))));
    years.add(today().getFullYear());
    const list = [...years].sort((a, b) => b - a);
    if (!years.has(sumYear)) sumYear = list[0];

    const tabs = $("yearTabs");
    tabs.innerHTML = "";
    list.forEach((y) => {
      const b = document.createElement("button");
      b.className = "year-tab" + (y === sumYear ? " on" : "");
      b.textContent = `${y}年`;
      b.addEventListener("click", () => { sumYear = y; renderSummary(); });
      tabs.appendChild(b);
    });

    const pro = isPro();
    $("lock").hidden = pro;
    $("yearBody").hidden = !pro;
    if (NATIVE) {
      // Google Play のアプリでは外部の決済に案内できないため、Play の課金を入れるまで準備中にする
      $("price").textContent = "近日公開";
      $("buyBtn").hidden = true;
      $("codeRow").hidden = true;
      $("pdfFeature").hidden = true;
      $("savePdf").hidden = true;
    } else {
      $("price").textContent = CFG.paymentUrl ? (CFG.proPrice || "") : "準備中";
      $("buyBtn").href = CFG.paymentUrl || "#";
    }
    if (!pro) return;

    const yd = yearData(sumYear);
    $("yearTitle").textContent = `${sumYear}年の一言`;
    $("yearStats").innerHTML =
      `<div><b>${yd.keys.length}</b>書いた日</div><div><b>${yd.best}</b>最長連続</div><div><b>${yd.photos}</b>写真</div>`;

    const box = $("months");
    box.innerHTML = "";
    if (!yd.keys.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.style.marginTop = "18px";
      e.textContent = "この年の一言はまだありません。";
      box.appendChild(e);
      return;
    }
    Object.keys(yd.months).map(Number).sort((a, b) => a - b).forEach((m) => {
      const sec = document.createElement("div");
      sec.className = "month";
      const h = document.createElement("h4");
      h.innerHTML = `${m}月<small>${yd.months[m].length}日</small>`;
      sec.appendChild(h);
      yd.months[m].forEach((k) => {
        const rec = entries[k];
        const line = document.createElement("div");
        line.className = "line";
        const d = document.createElement("span");
        d.className = "d";
        d.textContent = `${Number(k.slice(8))}日`;
        const tx = document.createElement("span");
        tx.className = "t hand";
        tx.textContent = rec.text || "（写真）";
        line.append(d, tx);
        const u = photoURL(k);
        if (u) { const im = document.createElement("img"); im.src = u; im.alt = ""; line.appendChild(im); }
        sec.appendChild(line);
      });
      box.appendChild(sec);
    });
  }

  // ---- 1年分を1枚の画像にする ----
  async function makeYearImage(y) {
    const yd = yearData(y);
    try {
      await Promise.all([
        document.fonts.load('600 64px "Klee One"'),
        document.fonts.load('400 30px "Klee One"'),
        document.fonts.load('700 36px "Zen Kaku Gothic New"'),
        document.fonts.load('400 26px "Zen Kaku Gothic New"'),
      ]);
    } catch (e) {}
    const css = getComputedStyle(document.documentElement);
    const C = (n) => css.getPropertyValue(n).trim();
    const col = { bg: C("--bg"), card: C("--card"), ink: C("--ink"), sub: C("--sub"), line: C("--line"), accent: C("--accent") };
    const HAND = '"Klee One", serif', GOTHIC = '"Zen Kaku Gothic New", sans-serif';

    const W = 1080, P = 80, DATE_W = 96, THUMB = 88, LH = 46;
    const bitmaps = {};
    for (const k of yd.keys) {
      if (entries[k].photo) { try { bitmaps[k] = await createImageBitmap(entries[k].photo); } catch (e) {} }
    }

    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    function wrap(text, width) {
      const lines = []; let cur = "";
      for (const ch of Array.from(text)) {
        if (ctx.measureText(cur + ch).width > width && cur) { lines.push(cur); cur = ch; }
        else cur += ch;
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [""];
    }

    // 1回目: 高さを測る / 2回目: 描く
    function layout(draw) {
      let yy = P;
      if (draw) {
        ctx.fillStyle = col.bg; ctx.fillRect(0, 0, cv.width, cv.height);
      }
      ctx.textBaseline = "top";
      ctx.font = `600 64px ${HAND}`;
      if (draw) { ctx.fillStyle = col.ink; ctx.fillText(`${y}年の一言`, P, yy); }
      yy += 96;
      ctx.font = `400 28px ${GOTHIC}`;
      if (draw) {
        ctx.fillStyle = col.sub;
        ctx.fillText(`書いた日 ${yd.keys.length}日 ・ 最長連続 ${yd.best}日 ・ 写真 ${yd.photos}枚`, P, yy);
      }
      yy += 72;
      Object.keys(yd.months).map(Number).sort((a, b) => a - b).forEach((m) => {
        yy += 18;
        ctx.font = `700 36px ${GOTHIC}`;
        if (draw) { ctx.fillStyle = col.accent; ctx.fillText(`${m}月`, P, yy); }
        yy += 54;
        if (draw) { ctx.fillStyle = col.line; ctx.fillRect(P, yy, W - P * 2, 3); }
        yy += 18;
        yd.months[m].forEach((k) => {
          const rec = entries[k];
          const bm = bitmaps[k];
          const textW = W - P * 2 - DATE_W - (bm ? THUMB + 20 : 0);
          ctx.font = `400 30px ${HAND}`;
          const lines = wrap(rec.text || "（写真）", textW);
          const h = Math.max(lines.length * LH, bm ? THUMB + 8 : 0);
          if (draw) {
            ctx.font = `400 24px ${GOTHIC}`;
            ctx.fillStyle = col.sub;
            ctx.fillText(`${Number(k.slice(8))}日`, P, yy + 8);
            ctx.font = `400 30px ${HAND}`;
            ctx.fillStyle = col.ink;
            lines.forEach((ln, i) => ctx.fillText(ln, P + DATE_W, yy + 4 + i * LH));
            if (bm) {
              const s = Math.max(THUMB / bm.width, THUMB / bm.height);
              const sw = THUMB / s, sh = THUMB / s;
              ctx.save();
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(W - P - THUMB, yy, THUMB, THUMB, 12);
              else ctx.rect(W - P - THUMB, yy, THUMB, THUMB);
              ctx.clip();
              ctx.drawImage(bm, (bm.width - sw) / 2, (bm.height - sh) / 2, sw, sh, W - P - THUMB, yy, THUMB, THUMB);
              ctx.restore();
            }
          }
          yy += h + 14;
        });
      });
      yy += 40;
      ctx.font = `400 22px ${GOTHIC}`;
      if (draw) { ctx.fillStyle = col.sub; ctx.fillText("一言日記", P, yy); }
      yy += 30 + P;
      return yy;
    }
    cv.width = W; cv.height = 10;
    const H = layout(false);
    cv.width = W; cv.height = Math.min(H, 32000);
    layout(true);
    Object.values(bitmaps).forEach((b) => b.close && b.close());
    return await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  }

  $("saveImage").addEventListener("click", async () => {
    if (!isPro()) return;
    toast("画像を作っています…");
    const blob = await makeYearImage(sumYear);
    if (!blob) { toast("画像を作れませんでした"); return; }
    if (NATIVE) { await shareNative(blob, `hitokoto_${sumYear}.png`); return; }
    const name = `一言日記_${sumYear}.png`;
    const file = new File([blob], name, { type: "image/png" });
    // スマホは共有メニュー（写真に保存など）、PCはダウンロード
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia("(pointer:coarse)").matches) {
      try { await navigator.share({ files: [file], title: `${sumYear}年の一言` }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("画像を保存しました");
  });
  // アプリ版: いったん端末に書き出して、共有メニュー（写真に保存・LINEなど）を開く
  async function shareNative(blob, name) {
    const { Filesystem, Share } = Plugins;
    if (!Filesystem || !Share) { toast("この端末では保存できませんでした"); return; }
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const res = await Filesystem.writeFile({ path: name, data, directory: "CACHE" });
      await Share.share({ title: `${sumYear}年の一言`, files: [res.uri] });
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) toast("保存できませんでした");
    }
  }
  $("savePdf").addEventListener("click", () => { if (isPro()) window.print(); });

  // =========================================================
  // 画面切り替え
  // =========================================================
  let view = "home";
  function go(v) {
    view = v;
    ["home", "calendar", "summary"].forEach((id) => { $(id).hidden = id !== v; });
    $("toHome").hidden = v === "home";
    $("toCal").hidden = v === "calendar";
    if (v === "calendar") { const t = today(); calY = t.getFullYear(); calM = t.getMonth(); }
    render();
    window.scrollTo(0, 0);
  }
  $("toCal").addEventListener("click", () => go("calendar"));
  $("toHome").addEventListener("click", () => go("home"));

  function render() {
    if (view === "home") renderHome();
    else if (view === "calendar") renderCal();
    else renderSummary();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
  setInterval(() => { if (view === "home" && keyOf(today()) !== shownDay) render(); }, 60000);

  // =========================================================
  // 起動
  // =========================================================
  (async function start() {
    buildThemes();
    applyTheme(lsGet("hitokoto.theme", "kinari"));
    await loadAll();

    // 決済後に ?unlock=コード で戻ってきたとき
    const params = new URLSearchParams(location.search);
    if (params.has("unlock")) {
      const ok = await tryUnlock(params.get("unlock"));
      history.replaceState(null, "", location.pathname);
      if (ok) { go("summary"); toast("ご購入ありがとうございます！"); return; }
    }
    go("home");
  })();

  if (!NATIVE && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

})();
