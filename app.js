'use strict';
/* music（旧名 Hibiki） — YouTube の公式埋め込みプレーヤーで再生する音楽ライブラリ。仕様は for_agent/spec.md */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const KEY = 'hibiki.v1'; // 旧名のまま（変えると保存済みのデータが読めなくなる）
const DAY = 864e5;

/* ---------- icons ---------- */
const ICONS = {
  play: ['f', 'M8 5v14l11-7z'],
  pause: ['f', 'M6 5h4v14H6zM14 5h4v14h-4z'],
  next: ['f', 'M6 6l8.5 6L6 18zM16 6h2v12h-2z'],
  prev: ['f', 'M18 6l-8.5 6L18 18zM6 6h2v12H6z'],
  home: ['s', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  search: ['s', 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3'],
  library: ['s', 'M4 4v16M9 4v16M14 5l5 15'],
  heart: ['s', 'M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z'],
  plus: ['s', 'M12 5v14M5 12h14'],
  more: ['d', 'M5 12h.01M12 12h.01M19 12h.01'],
  shuffle: ['s', 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5'],
  repeat: ['s', 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3'],
  volume: ['s', 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'],
  settings: ['s', 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4'],
  queue: ['s', 'M4 6h16M4 12h16M4 18h10'],
  list: ['s', 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
};
function icon(name) {
  const [kind, d] = ICONS[name];
  const attrs = kind === 'f' ? 'fill="currentColor"'
    : `fill="none" stroke="currentColor" stroke-width="${kind === 'd' ? 3 : 2}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg class="${name}" viewBox="0 0 24 24" ${attrs} aria-hidden="true"><path d="${d}"/></svg>`;
}

/* ---------- state ---------- */
const defaults = () => ({
  tracks: {}, playlists: [], history: [], queue: [], qi: -1,
  settings: { apiKey: '', volume: 80, shuffle: false, repeat: 'off' },
});
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.tracks) return { ...defaults(), ...s, settings: { ...defaults().settings, ...s.settings } };
  } catch { /* 壊れていたら初期状態 */ }
  return defaults();
}
let state = load();
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('保存できませんでした（ブラウザの保存領域を確認してください）'); }
  }, 150);
}
/* どこからも参照されていない曲（検索結果の残りなど）を捨てる */
function prune() {
  const keep = new Set([...state.queue, ...state.history.map(h => h.id), ...state.playlists.flatMap(p => p.ids)]);
  for (const t of Object.values(state.tracks)) if (!t.lib && !keep.has(t.id)) delete state.tracks[t.id];
  state.queue = state.queue.filter(id => state.tracks[id]);
  if (state.qi >= state.queue.length) state.qi = state.queue.length - 1;
}
prune();

const T = id => state.tracks[id];
const libTracks = () => Object.values(state.tracks).filter(t => t.lib);
const thumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const ytUrl = id => `https://www.youtube.com/watch?v=${id}`;
const PL = id => state.playlists.find(p => p.id === id);
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const fmtTotal = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`; };

function know(t) {
  const o = state.tracks[t.id];
  if (o) {
    if (o.pending && !t.pending) { o.title = t.title; o.artist = t.artist; delete o.pending; }
    return o;
  }
  return state.tracks[t.id] = { id: t.id, title: t.title, artist: t.artist, plays: 0, ...(t.pending ? { pending: true } : {}) };
}
function addToLibrary(id) {
  const t = T(id);
  if (!t || t.lib) return false;
  t.lib = true; t.addedAt = now(); save();
  return true;
}
function removeFromLibrary(id) {
  const t = T(id); if (!t) return;
  delete t.lib; delete t.liked; save();
}
function toggleLike(id) {
  const t = T(id); if (!t) return;
  t.liked = !t.liked;
  if (t.liked) addToLibrary(id);
  save(); refresh();
  toast(t.liked ? 'お気に入りに追加しました' : 'お気に入りから外しました');
}

/* ---------- YouTube: URL 解析とメタデータ ---------- */
function parseYT(s, allowBare) {
  s = String(s).trim();
  const list = (s.match(/[?&]list=([\w-]{12,})/) || [])[1] || null;
  const m = /^https?:\/\//i.test(s) || /^(www\.|m\.|music\.)?youtu/i.test(s)
    ? s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})(?![\w-])/) : null;
  const vid = m ? m[1] : (allowBare && /^[\w-]{11}$/.test(s) ? s : null);
  return { vid, list };
}
function cleanArtist(a) {
  return String(a || '不明').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*(Official|公式)(\s*(YouTube\s*)?Channel|チャンネル)?$/i, '').trim() || '不明';
}
function cleanTitle(title, artist) {
  let t = String(title || '').replace(/\s*[(\[【［（][^)\]】］）]*(official|music\s*video|\bMV\b|M\/V|lyric|audio|公式|ミュージックビデオ|4K|HD)[^)\]】］）]*[)\]】］）]/gi, '').trim();
  const a = artist.toLowerCase();
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const same = s => s.toLowerCase().replace(/\s/g, '') === a.replace(/\s/g, '');
  if (m && same(m[1])) t = m[2];
  else if (m && same(m[2])) t = m[1];
  return t || title || '無題';
}
/* 「アーティスト - 曲名」形式で、前半がチャンネル名に含まれていればそれをアーティスト名にする */
function nameParts(rawTitle, channel) {
  let artist = cleanArtist(channel);
  const squash = s => s.toLowerCase().replace(/[\s._-]/g, '');
  const m = String(rawTitle).match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && m[1].length >= 2 && squash(artist).includes(squash(m[1]))) artist = m[1].trim();
  return { title: cleanTitle(rawTitle, artist), artist };
}
const decodeEntities =s => { const el = document.createElement('textarea'); el.innerHTML = s; return el.value; };

async function fetchMeta(id) {
  if (T(id) && !T(id).pending) return T(id);
  for (const ep of ['https://www.youtube.com/oembed?format=json&url=', 'https://noembed.com/embed?url=']) {
    try {
      const r = await fetch(ep + encodeURIComponent(ytUrl(id)));
      if (!r.ok) continue;
      const j = await r.json();
      if (j.title) return know({ id, ...nameParts(j.title, j.author_name) });
    } catch { /* 次の取得先へ */ }
  }
  return know({ id, title: 'YouTube 動画 ' + id, artist: '不明', pending: true });
}

const searchCache = new Map();
async function apiSearch(q, max = 24) {
  const ck = max + ':' + q.toLowerCase();
  if (searchCache.has(ck)) return searchCache.get(ck);
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true'
    + `&maxResults=${max}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'X-Goog-Api-Key': state.settings.apiKey } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason || '';
    const quota = /quota|rateLimit/i.test(reason);
    const err = new Error(quota ? '今日の検索回数の上限に達しました（YouTube API の割り当て）。明日また使えます。'
      : /key|forbidden|denied/i.test(reason + (j.error?.status || '')) ? 'API キーが正しくないか、YouTube Data API v3 が有効になっていません。設定を確認してください。'
      : 'YouTube の検索に失敗しました（' + (j.error?.message || r.status) + '）');
    err.quota = quota;
    throw err;
  }
  const ids = (j.items || []).filter(it => it.id?.videoId).map(it => {
    return know({ id: it.id.videoId, ...nameParts(decodeEntities(it.snippet.title), decodeEntities(it.snippet.channelTitle)) }).id;
  });
  searchCache.set(ck, ids);
  return ids;
}

/* 再生リストの中身は、再生しない一時プレーヤーに読み込ませて ID 一覧だけ受け取る（API キー不要） */
function playlistVideoIds(listId) {
  return new Promise(resolve => {
    if (!window.YT || !YT.Player) return resolve([]);
    const host = document.createElement('div');
    $('#probe').appendChild(host);
    let p, done = false, poll;
    const finish = ids => {
      if (done) return; done = true; clearInterval(poll);
      try { p.destroy(); } catch { /* noop */ }
      $('#probe').innerHTML = '';
      resolve(ids || []);
    };
    p = new YT.Player(host, {
      width: 200, height: 200, playerVars: { listType: 'playlist', list: listId },
      events: {
        onReady: () => { poll = setInterval(() => { const ids = p.getPlaylist && p.getPlaylist(); if (ids && ids.length) finish(ids); }, 300); },
        onError: () => finish([]),
      },
    });
    setTimeout(() => finish([]), 12000);
  });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/* 動画 URL に list= が付いているだけのときは、その 1 曲だけを追加する（wholeList のときは中身すべて） */
async function addFromText(text, plId, wholeList) {
  const all = text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const extLinks = all.filter(parseExt);
  if (extLinks.length) await importExt(extLinks.join('\n'));
  const lines = all.filter(l => !parseExt(l));
  if (!lines.length) return [];
  const vids = []; let bad = 0;
  toast('読み込んでいます…', 0);
  for (const line of lines) {
    const { vid, list } = parseYT(line, true);
    if (list && (wholeList || !vid)) { const ids = await playlistVideoIds(list); if (ids.length) vids.push(...ids); else if (vid) vids.push(vid); else bad++; }
    else if (vid) vids.push(vid);
    else bad++;
  }
  const uniq = [...new Set(vids)];
  await pool(uniq, 6, fetchMeta);
  let added = 0;
  const pl = plId && PL(plId);
  for (const id of uniq) {
    if (addToLibrary(id)) added++;
    if (pl && !pl.ids.includes(id)) pl.ids.push(id);
  }
  save(); refresh();
  toast(uniq.length
    ? `${uniq.length}曲を読み込みました` + (added < uniq.length ? `（新規 ${added}曲）` : '') + (pl ? `／「${pl.name}」に追加` : '') + (bad ? `／読めなかった行 ${bad}件` : '')
    : 'YouTube の URL を読み取れませんでした');
  return uniq;
}

/* ---------- 外部アプリのプレイリスト（公式埋め込みプレーヤーで、そのアプリ自身の音源を再生） ---------- */
const EXT = { apple: 'Apple Music', spotify: 'Spotify' };
const EXT_KIND = { playlist: 'プレイリスト', album: 'アルバム', song: '曲', track: '曲', station: 'ステーション' };
const EXT_EMBED = { apple: 'https://embed.music.apple.com/', spotify: 'https://open.spotify.com/embed/' };
const extOk = x => x && EXT[x.src] && typeof x.embed === 'string' && x.embed.startsWith(EXT_EMBED[x.src]);

function parseExt(s) {
  s = String(s).trim();
  let m = s.match(/^https?:\/\/(?:embed\.)?music\.apple\.com\/([a-z]{2})\/(playlist|album|song|station)\/(?:([^\/?#\s]+)\/)?([\w.-]+)/i);
  if (m) {
    const [, cc, kind, slug, id] = m;
    const i = kind === 'album' ? (s.match(/[?&]i=(\d+)/) || [])[1] : null;
    const path = `${cc.toLowerCase()}/${kind.toLowerCase()}/${slug ? slug + '/' : ''}${id}${i ? '?i=' + i : ''}`;
    let name = '';
    try { name = decodeURIComponent(slug || '').replace(/-/g, ' ').trim(); } catch { /* 名前なしで続ける */ }
    return { src: 'apple', kind: kind.toLowerCase(), embed: EXT_EMBED.apple + path, page: 'https://music.apple.com/' + path, name: name || 'Apple Music の' + EXT_KIND[kind.toLowerCase()] };
  }
  m = s.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]+)/i);
  if (m) {
    const kind = m[1].toLowerCase();
    return { src: 'spotify', kind, embed: `${EXT_EMBED.spotify}${kind}/${m[2]}`, page: `https://open.spotify.com/${kind}/${m[2]}`, name: 'Spotify の' + EXT_KIND[kind] };
  }
  return null;
}
/* 公開版（GitHub Pages）のアドレス。公開版には server.py がないので /api/ は使えない */
const PUBLIC_URL = 'https://aoi0909zzz.github.io/music/';
const HOSTED = location.protocol === 'https:';
/* 名前とカバー画像は各サービスの oEmbed から。取れなければ URL から作った名前のまま */
async function extMeta(x) {
  const ep = x.src === 'spotify' ? 'https://open.spotify.com/oembed?url=' : 'https://music.apple.com/api/oembed?url=';
  try {
    const r = await fetch(ep + encodeURIComponent(x.page));
    if (!r.ok) return;
    const j = await r.json();
    if (j.title) x.name = String(j.title).slice(0, 80);
    if (/^https:\/\//.test(j.thumbnail_url || '')) x.thumb = j.thumbnail_url;
  } catch { /* 取得できなくても引き継ぎは続ける */ }
}
async function importExt(text) {
  const found = String(text).split(/\s+/).map(parseExt).filter(Boolean);
  if (!found.length) { toast('Apple Music または Spotify の共有リンクを読み取れませんでした'); return []; }
  toast('読み込んでいます…', 0);
  const made = [];
  let dup = 0;
  for (const x of found) {
    const old = state.playlists.find(p => p.ext && p.ext.embed === x.embed);
    if (old) { dup++; made.push(old); continue; }
    await extMeta(x);
    const { name, ...ext } = x;
    const p = { id: uid(), name, ids: [], at: now(), ext };
    state.playlists.push(p); made.push(p);
  }
  save(); refresh();
  toast(made.length === 1 ? (dup ? `「${made[0].name}」は引き継ぎ済みです` : `「${made[0].name}」を引き継ぎました`) : `${made.length - dup}件を引き継ぎました` + (dup ? `（引き継ぎ済み ${dup}件）` : ''));
  if (made.length === 1) location.hash = '#/playlist/' + made[0].id;
  return made;
}

/* ---------- 外部プレイリスト → YouTube 版（サインインなしで全曲聴くため） ---------- */
const norm = s => String(s).toLowerCase().replace(/[\s\-_.,'’"“”!?()\[\]（）【】・]/g, '');
const firstArtist = a => String(a).split(/[,、]/)[0].trim();
const NOT_ORIGINAL = /cover|カバー|歌ってみた|karaoke|カラオケ|instrumental|off ?vocal|reaction|リアクション|slowed|sped ?up|nightcore|8d audio|弾いてみた|叩いてみた|tutorial|踊ってみた/i;
const convLeft = p => (p.conv ? p.conv.tracks.filter(t => !t.id && !t.miss).length : 0);
let convRunning = null;

function needKey() {
  modal(`<h2>YouTube の API キーが必要です</h2><p>曲を 1 曲ずつ YouTube で探すために、YouTube Data API キー（無料）を使います。設定画面で登録してから、もう一度お試しください。</p>
    <div class="actions"><button type="button" class="btn ghost" data-close>あとで</button><button type="submit" class="btn">設定を開く</button></div>`, () => { location.hash = '#/settings'; });
}
async function matchTrack(tr) {
  const nt = norm(tr.title), na = norm(firstArtist(tr.artist));
  const known = Object.values(state.tracks).find(t => t.lib && norm(t.title) === nt && na && norm(t.artist).includes(na));
  if (known) return known.id;
  const ids = await apiSearch(`${firstArtist(tr.artist)} ${tr.title}`, 5);
  const score = id => {
    const t = T(id), ta = norm(t.artist);
    return (NOT_ORIGINAL.test(t.title) && !NOT_ORIGINAL.test(tr.title) ? -5 : 0)
      + (na && (ta.includes(na) || na.includes(ta)) ? 3 : 0) + (norm(t.title + t.artist).includes(nt) ? 2 : 0);
  };
  return ids.map((id, i) => [id, score(id), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2])[0]?.[0] || null;
}
/* 元の曲順を保つ位置に差し込む（途中で手で並べ替えられていても壊さない） */
function convInsert(p, i, id) {
  if (p.ids.includes(id)) return;
  let pos = 0;
  for (let k = i - 1; k >= 0; k--) {
    const at = p.conv.tracks[k].id ? p.ids.indexOf(p.conv.tracks[k].id) : -1;
    if (at >= 0) { pos = at + 1; break; }
  }
  p.ids.splice(pos, 0, id);
}
async function runConv(plId) {
  if (convRunning) { if (convRunning !== plId) toast('別のプレイリストを置き換え中です。終わってからお試しください'); return; }
  const p = PL(plId);
  if (!p || !convLeft(p)) return;
  if (!state.settings.apiKey) return needKey();
  convRunning = plId; delete p.conv.stopped; refresh();
  const total = p.conv.tracks.length;
  let done = 0, msg = '';
  try {
    for (let i = 0; i < total; i++) {
      const tr = p.conv.tracks[i];
      if (tr.id || tr.miss) continue;
      if (!PL(plId)) break;
      toast(`YouTube で探しています… ${total - convLeft(p) + 1} / ${total}`, 0);
      const id = await matchTrack(tr);
      if (id) { tr.id = id; convInsert(p, i, id); addToLibrary(id); done++; } else tr.miss = true;
      save();
      if (location.hash === '#/playlist/' + plId) refresh();
    }
  } catch (e) {
    if (e.quota) { p.conv.stopped = now(); msg = `今日の検索枠を使い切りました。残り ${convLeft(p)}曲は、明日以降にアプリを開くと続きから再開します`; }
    else msg = e.message || '置き換えを中断しました';
  }
  convRunning = null;
  const miss = p.conv ? p.conv.tracks.filter(t => t.miss).length : 0;
  if (p.conv && !convLeft(p) && !miss) delete p.conv;
  save(); refresh();
  toast(msg || `${done}曲を YouTube に置き換えました` + (miss ? `（見つからなかった曲 ${miss}曲）` : ''), 6000);
}
async function convertExt(extPlId) {
  const src = PL(extPlId);
  if (!src || !src.ext) return;
  const exist = state.playlists.find(p => p.convFrom === src.ext.page);
  if (exist) { location.hash = '#/playlist/' + exist.id; if (convLeft(exist)) runConv(exist.id); else toast('YouTube 版は作成済みです'); return; }
  if (HOSTED) return toast('曲の読み取りは、パソコンで start.bat から起動した music でだけ行えます。パソコンで YouTube 版を作り、設定の「書き出す」「読み込む」でこちらへ移してください', 9000);
  if (!state.settings.apiKey) return needKey();
  toast('曲の一覧を読み取っています…', 0);
  let data;
  try {
    const r = await fetch('/api/tracks?url=' + encodeURIComponent(src.ext.page));
    data = await r.json();
    if (!r.ok || !Array.isArray(data.tracks)) throw new Error(data.error || '');
  } catch (e) {
    return toast(/[ぁ-ん]/.test(e.message) ? e.message : '曲の一覧を読み取れませんでした。start.bat から起動しているか確認してください', 6000);
  }
  const tracks = data.tracks.slice(0, 500).map(t => ({ title: String(t.title).slice(0, 200), artist: String(t.artist || '').slice(0, 200) }));
  const p = { id: uid(), name: src.name, ids: [], at: now(), convFrom: src.ext.page, conv: { src: src.ext.src, total: Math.max(+data.total || 0, tracks.length), tracks } };
  state.playlists.push(p); save();
  location.hash = '#/playlist/' + p.id;
  runConv(p.id);
}
function convPanel(p) {
  const c = p.conv;
  if (!c) return '';
  const left = convLeft(p), miss = c.tracks.filter(t => t.miss), svc = EXT[c.src] || '外部アプリ';
  let out = '';
  if (convRunning === p.id) out += `<div class="panel"><h2>YouTube で探しています</h2><p>残り ${left}曲。見つかった曲から順に下へ並びます。このまま他の画面を使っていても続きます。</p></div>`;
  else if (left) out += `<div class="panel"><h2>残り ${left}曲がまだです</h2><p>${c.stopped ? '検索枠（1日およそ100曲）を使い切ったため止まっています。明日以降にアプリを開くと自動で再開します。' : '置き換えが途中で止まっています。'}</p>
    <div class="actions"><button class="btn ghost" data-action="run-conv" data-pl="${p.id}">続きから再開</button></div></div>`;
  if (c.total > c.tracks.length) out += `<div class="panel"><p>元のプレイリストは ${c.total}曲ですが、${svc} の公開ページから読み取れたのは先頭の ${c.tracks.length}曲です。</p></div>`;
  if (miss.length) out += `<div class="panel"><h2>見つからなかった曲（${miss.length}曲）</h2><p>YouTube で探して、動画の URL を「URL で追加」から入れられます。</p><ul class="miss">${miss.map(t =>
    `<li><span>${esc(t.title)}<small>${esc(t.artist)}</small></span><a class="chip" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(t.artist + ' ' + t.title)}">YouTube で探す</a></li>`).join('')}</ul>
    <div class="actions"><button class="btn ghost" data-action="conv-dismiss" data-pl="${p.id}">この一覧を消す</button></div></div>`;
  return out;
}

let extId = null;
function openExt(id) {
  const p = PL(id);
  if (!p || !extOk(p.ext)) return toast('このプレイリストは開けません');
  if (ytReady && current) yt.pauseVideo();
  extId = id;
  const wrap = $('#ext-wrap');
  wrap.innerHTML = `<div class="ext-head"><span><b>${esc(p.name)}</b><small>${EXT[p.ext.src]} の公式プレーヤー</small></span><button class="link" data-action="close-ext">閉じる</button></div>`;
  const f = document.createElement('iframe');
  f.title = `${EXT[p.ext.src]}：${p.name}`;
  if (p.ext.src === 'apple') {
    f.allow = 'autoplay *; encrypted-media *; fullscreen *; clipboard-write';
    f.setAttribute('sandbox', 'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation');
  } else f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  f.src = p.ext.embed;
  wrap.appendChild(f);
  wrap.hidden = false;
  document.body.classList.add('ext', 'now-open');
  updateNow(); refresh();
}
function closeExt() {
  if (!extId) return;
  extId = null;
  const wrap = $('#ext-wrap');
  wrap.innerHTML = ''; wrap.hidden = true;
  document.body.classList.remove('ext', 'now-open');
  updateNow(); refresh();
}

/* ---------- player ---------- */
let yt = null, ytReady = false, current = null, counted = false, errStreak = 0, seeking = false, playing = false;

function loadYT() {
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.onerror = () => toast('YouTube プレーヤーを読み込めませんでした。ネットワークを確認してください。');
  document.head.appendChild(s);
}
window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('player-host', {
    width: '100%', height: '100%',
    playerVars: { playsinline: 1, rel: 0, origin: location.origin },
    events: {
      onReady() {
        ytReady = true;
        yt.setVolume(state.settings.volume);
        const id = state.queue[state.qi];
        if (current) yt.loadVideoById(current);
        else if (id && T(id)) { current = id; yt.cueVideoById(id); updateNow(); refresh(); }
      },
      onStateChange(e) {
        playing = e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING;
        if (e.data === YT.PlayerState.PLAYING) { errStreak = 0; fillPending(); }
        if (e.data === YT.PlayerState.ENDED) next(true);
        updatePlayBtn();
      },
      onError(e) {
        const t = T(current);
        const why = [101, 150].includes(e.data) ? '埋め込み再生が許可されていません' : e.data === 100 ? '動画が見つかりません' : '再生できません';
        toast(`「${t ? t.title : ''}」は${why}。`);
        if (++errStreak < Math.min(5, state.queue.length)) next(true, true);
        else { playing = false; updatePlayBtn(); }
      },
    },
  });
};
function fillPending() {
  const t = T(current);
  if (!t || !t.pending || !yt.getVideoData) return;
  const d = yt.getVideoData();
  if (d && d.title) { Object.assign(t, nameParts(d.title, d.author)); delete t.pending; save(); updateNow(); refresh(); }
}

function shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function playList(ids, idx = 0, forceShuffle) {
  ids = ids.filter(T);
  if (!ids.length) return;
  if (forceShuffle != null) { state.settings.shuffle = forceShuffle; }
  if (state.settings.shuffle) {
    const first = forceShuffle ? null : ids[idx];
    const rest = shuffled(first ? ids.filter((_, i) => i !== idx) : ids);
    state.queue = first ? [first, ...rest] : rest; state.qi = 0;
  } else { state.queue = ids.slice(); state.qi = idx; }
  errStreak = 0;
  playCurrent();
}
function playCurrent() {
  const id = state.queue[state.qi];
  if (!id || !T(id)) return;
  if (extId) { extId = null; $('#ext-wrap').innerHTML = ''; $('#ext-wrap').hidden = true; document.body.classList.remove('ext', 'now-open'); }
  current = id; counted = false;
  const t = T(id);
  t.last = now();
  state.history.unshift({ id, at: now() });
  if (state.history.length > 300) state.history.length = 300;
  if (ytReady) yt.loadVideoById(id);
  playing = true;
  save(); updateNow(); refresh();
}
function next(auto, skipRepeatOne) {
  if (auto && !skipRepeatOne && state.settings.repeat === 'one' && ytReady) { yt.seekTo(0, true); yt.playVideo(); return; }
  if (state.qi < state.queue.length - 1) state.qi++;
  else if (state.settings.repeat === 'all' && state.queue.length) state.qi = 0;
  else { if (!auto) toast('キューの最後の曲です'); playing = false; updatePlayBtn(); return; }
  playCurrent();
}
function prev() {
  if (ytReady && current && yt.getCurrentTime() > 3) return yt.seekTo(0, true);
  if (state.qi > 0) { state.qi--; playCurrent(); }
  else if (ytReady && current) yt.seekTo(0, true);
}
function toggle() {
  if (extId) return toast(`${EXT[PL(extId).ext.src]} のプレーヤー内のボタンで操作してください`);
  if (!current) {
    const ids = libTracks().sort((a, b) => b.addedAt - a.addedAt).map(t => t.id);
    return ids.length ? playList(ids, 0) : toast('まず曲を追加してください');
  }
  if (!ytReady) return;
  if (yt.getPlayerState() === YT.PlayerState.PLAYING) yt.pauseVideo(); else yt.playVideo();
}
function queueNext(id) {
  if (!current) return playList([id]);
  state.queue.splice(state.qi + 1, 0, id); save(); renderQueue(); toast('次に再生します');
}
function queueAdd(id) {
  if (!current) return playList([id]);
  state.queue.push(id); save(); renderQueue(); toast('キューに追加しました');
}
function setShuffle(on) {
  state.settings.shuffle = on;
  if (on && state.qi >= 0) state.queue = [...state.queue.slice(0, state.qi + 1), ...shuffled(state.queue.slice(state.qi + 1))];
  save(); updateModes(); renderQueue();
}

setInterval(() => {
  if (!ytReady || !current || extId || !yt.getCurrentTime) return;
  const cur = yt.getCurrentTime() || 0, dur = yt.getDuration() || 0;
  if (!seeking) setRange($('#seek'), dur ? cur / dur * 1000 : 0);
  $('#t-cur').textContent = fmt(cur);
  $('#t-dur').textContent = fmt(dur);
  const t = T(current);
  if (t && dur && t.dur !== Math.round(dur)) { t.dur = Math.round(dur); save(); }
  if (t && !counted && playing && cur >= 15) { counted = true; t.plays = (t.plays || 0) + 1; save(); }
}, 500);

function setRange(el, v) { el.value = v; el.style.setProperty('--p', (el.max > 0 ? v / el.max * 100 : 0) + '%'); }

/* ---------- 常駐 UI（バー・再生中パネル・サイドバー） ---------- */
function updatePlayBtn() {
  const b = $('#btn-play');
  b.innerHTML = icon(playing ? 'pause' : 'play');
  b.setAttribute('aria-label', playing ? '一時停止' : '再生');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}
function updateModes() {
  $('#btn-shuffle').classList.toggle('on', state.settings.shuffle);
  const r = $('#btn-repeat');
  r.classList.toggle('on', state.settings.repeat !== 'off');
  r.classList.toggle('one', state.settings.repeat === 'one');
  r.title = { off: 'リピート：オフ', all: 'リピート：全曲', one: 'リピート：1曲' }[state.settings.repeat];
}
function updateNow() {
  const x = extId && PL(extId);
  if (x) {
    document.body.classList.add('has-track');
    $('#bar-thumb').hidden = !x.ext.thumb;
    if (x.ext.thumb) $('#bar-thumb').src = x.ext.thumb;
    $('#bar-like').hidden = true;
    $('#bar-title').textContent = x.name;
    $('#bar-artist').textContent = `${EXT[x.ext.src]} のプレーヤー内で操作します`;
    $('#bar-artist').dataset.name = '';
    document.title = `${x.name} – music`;
    playing = false; updatePlayBtn();
    return;
  }
  const t = T(current);
  document.body.classList.toggle('has-track', !!t);
  $('#bar-thumb').hidden = !t; $('#bar-like').hidden = !t;
  $('#bar-title').textContent = t ? t.title : '再生していません';
  $('#bar-artist').textContent = t ? t.artist : '';
  $('#bar-artist').dataset.name = t ? t.artist : '';
  if (t) { $('#bar-thumb').src = thumb(t.id); $('#bar-like').classList.toggle('on', !!t.liked); }
  $('#now-info').innerHTML = t ? `<b>${esc(t.title)}</b><a href="#/artist/${encodeURIComponent(t.artist)}">${esc(t.artist)}</a>` : '';
  document.title = t ? `${t.title} – music` : 'music';
  if (t && 'mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, artwork: [{ src: thumb(t.id), sizes: '320x180', type: 'image/jpeg' }] });
  }
  updatePlayBtn(); renderQueue();
}
function renderQueue() {
  const up = state.queue.slice(state.qi + 1, state.qi + 61);
  lists.queue = state.queue;
  $('#queue').innerHTML = up.length ? up.map((id, k) => {
    const t = T(id), i = state.qi + 1 + k;
    return t ? `<li class="row" data-action="play-ctx" data-ctx="queue" data-idx="${i}" draggable="true">
      <img class="th" loading="lazy" src="${thumb(id)}" alt="">
      <span class="meta"><b>${esc(t.title)}</b><a>${esc(t.artist)}</a></span>
      <button class="ib" data-action="menu" data-id="${id}" data-ctx="queue" data-idx="${i}" aria-label="メニュー">${icon('more')}</button></li>` : '';
  }).join('') : '<li class="empty">この後に再生する曲はありません</li>';
}
function renderSide() {
  $('#side-playlists').innerHTML = state.playlists.length
    ? state.playlists.map(p => `<li data-pl="${p.id}"><a href="#/playlist/${p.id}" class="${location.hash === '#/playlist/' + p.id ? 'active' : ''}">${icon('list')}<span>${esc(p.name)}</span></a></li>`).join('')
    : '<li class="none">まだありません</li>';
}

/* ---------- 一覧の部品 ---------- */
const lists = {};
const reg = (key, ids) => (lists[key] = ids);

function row(id, i, ctx, drag) {
  const t = T(id); if (!t) return '';
  return `<li class="row${id === current ? ' cur' : ''}" data-action="play-ctx" data-ctx="${esc(ctx)}" data-idx="${i}"${drag ? ' draggable="true"' : ''}>
    <span class="num">${i + 1}</span>
    <img class="th" loading="lazy" src="${thumb(id)}" alt="">
    <span class="meta"><b>${esc(t.title)}</b><a data-action="artist" data-name="${esc(t.artist)}">${esc(t.artist)}</a></span>
    ${t.lib ? `<span class="plays">${t.plays ? t.plays + '回' : ''}</span>` : `<button class="chip" data-action="lib-add" data-id="${id}">＋ ライブラリ</button>`}
    <span class="dur">${t.dur ? fmt(t.dur) : ''}</span>
    <button class="ib${t.liked ? ' on' : ''}" data-action="like" data-id="${id}" aria-label="お気に入り" aria-pressed="${!!t.liked}">${icon('heart')}</button>
    <button class="ib" data-action="menu" data-id="${id}" data-ctx="${esc(ctx)}" data-idx="${i}" aria-label="メニュー">${icon('more')}</button>
  </li>`;
}
const rows = (ids, ctx, drag) => `<ol class="rows" data-list="${esc(ctx)}">${reg(ctx, ids).map((id, i) => row(id, i, ctx, drag)).join('')}</ol>`;

function card(id, i, ctx) {
  const t = T(id); if (!t) return '';
  return `<button class="card" data-action="play-ctx" data-ctx="${ctx}" data-idx="${i}" data-id="${id}" title="${esc(t.title)}">
    <span class="cv"><img loading="lazy" src="${thumb(id)}" alt=""><i>${icon('play')}</i></span>
    <b>${esc(t.title)}</b><small>${esc(t.artist)}</small></button>`;
}
function shelf(title, ctx, ids, note) {
  if (!ids.length) return '';
  reg(ctx, ids);
  return `<section class="sec"><div class="sec-head"><h2>${esc(title)}</h2>${note ? `<small>${esc(note)}</small>` : ''}</div>
    <div class="shelf">${ids.map((id, i) => card(id, i, ctx)).join('')}</div></section>`;
}
function mosaic(ids) {
  const a = ids.filter(T).slice(0, 4);
  if (!a.length) return `<span class="cv mosaic empty">${icon('list')}</span>`;
  const show = a.length >= 4 ? a : a.slice(0, 1);
  return `<span class="cv mosaic${show.length === 1 ? ' one' : ''}">${show.map(id => `<img loading="lazy" src="${thumb(id)}" alt="">`).join('')}</span>`;
}
const extCover = p => p.ext.thumb ? `<span class="cv mosaic one"><img loading="lazy" src="${esc(p.ext.thumb)}" alt=""></span>` : `<span class="cv mosaic empty">${icon('list')}</span>`;
const plCard = p => `<a class="card" href="#/playlist/${p.id}">${p.ext ? extCover(p) : mosaic(p.ids)}<b>${esc(p.name)}</b><small>${p.ext ? EXT[p.ext.src] : p.ids.length + '曲'}</small></a>`;
const ownPlaylists = () => state.playlists.filter(p => !p.ext);

/* ---------- おすすめ ---------- */
function dailyNoise(id) { let h = new Date().getDate(); for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000 * 3; }
function affinity() {
  const a = {};
  for (const t of Object.values(state.tracks)) a[t.artist] = (a[t.artist] || 0) + (t.plays || 0) + (t.liked ? 3 : 0);
  return a;
}
function recommend() {
  const lib = libTracks();
  if (lib.length < 4) return [];
  const aff = affinity();
  return lib.map(t => {
    const idle = t.last ? Math.min((now() - t.last) / DAY, 30) : 30;
    return { id: t.id, s: Math.min(aff[t.artist] || 0, 20) * 0.4 + (t.liked ? 2 : 0) + idle * 0.3 - (t.plays || 0) * 0.15 + dailyNoise(t.id) };
  }).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.id);
}
const remote = { artist: null, ids: [], busy: false, failed: false };
function topArtist() {
  const e = Object.entries(affinity()).filter(([n, v]) => v > 0 && n !== '不明').sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : null;
}
function ensureRemoteRecs() {
  const a = topArtist();
  if (!state.settings.apiKey || !a || remote.busy || remote.failed || remote.artist === a) return;
  remote.busy = true;
  apiSearch(a + ' official music video', 20)
    .then(ids => { remote.artist = a; remote.ids = ids.filter(id => !T(id).lib).slice(0, 12); })
    .catch(() => { remote.failed = true; })
    .finally(() => { remote.busy = false; if (route().name === 'home') refresh(); });
}

/* ---------- 画面 ---------- */
function route() {
  let h = location.hash.slice(2);
  const [name, ...rest] = h.split('/');
  let arg = rest.join('/');
  try { arg = decodeURIComponent(arg); } catch { /* そのまま使う */ }
  return { name: name || 'home', arg };
}
const SAMPLE_IDS = ['dQw4w9WgXcQ', 'fJ9rUzIMcZQ', 'kJQP7kiw5Fk', '9bZkp7q19f0', 'JGwWNGJdvx8', 'OPf0YbXqDm0', 'hT_nvWreIhg', 'YQHsXMglC9A'];
let libFilter = '', libSort = 'added';
const search = { q: '', ids: [], loading: false, error: '', list: null, seq: 0 };

const views = {
  home: {
    body() {
      const lib = libTracks();
      const h = new Date().getHours();
      const hello = h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは';
      if (!lib.length && !state.history.length) {
        return `<h1>music へようこそ</h1><p class="sub">YouTube の公式 MV を集めて、自分だけのライブラリとプレイリストで聴くためのプレーヤーです。</p>
          <div class="panel"><h2>はじめかた</h2>
            <div class="steps">
              <div><b>1. 曲を追加</b><span>YouTube の動画や再生リストの URL を貼り付けます。</span></div>
              <div><b>2. プレイリストに整理</b><span>曲の「…」メニューから追加、ドラッグで並べ替え。</span></div>
              <div><b>3. 聴くほど賢く</b><span>再生履歴から、ホームにおすすめが並びます。</span></div>
            </div>
            <div class="actions"><button class="btn" data-action="add-url">${icon('plus')}URL で曲を追加</button>
            <button class="btn ghost" data-action="import-ext">Apple Music などのプレイリストを引き継ぐ</button>
            <button class="btn ghost" data-action="samples">サンプル曲を入れて試す</button></div>
          </div>`;
      }
      ensureRemoteRecs();
      const recent = [...new Set(state.history.map(x => x.id))].filter(T).slice(0, 12);
      const top = Object.values(state.tracks).filter(t => t.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 12).map(t => t.id);
      const added = lib.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 12).map(t => t.id);
      const liked = lib.filter(t => t.liked).map(t => t.id);
      return `<h1>${hello}</h1>
        <div class="actions" style="margin-top:0">
          <button class="btn" data-action="play-all" data-ctx="home:all" data-shuffle="1">${icon('shuffle')}ライブラリをシャッフル</button>
          ${liked.length ? `<button class="btn ghost" data-action="play-all" data-ctx="home:liked">${icon('heart')}お気に入りを再生</button>` : ''}
          <button class="btn ghost" data-action="add-url">${icon('plus')}曲を追加</button>
        </div>`
        + (reg('home:all', lib.map(t => t.id)), reg('home:liked', liked), '')
        + shelf('最近再生した曲', 'home:recent', recent)
        + shelf('あなたへのおすすめ', 'home:recs', recommend(), 'よく聴くアーティストと、しばらく聴いていない曲から')
        + (remote.ids.length ? shelf(`${remote.artist} が好きなあなたに`, 'home:remote', remote.ids.filter(T), 'YouTube から') : '')
        + shelf('よく聴く曲', 'home:top', top)
        + shelf('最近追加した曲', 'home:added', added)
        + (state.playlists.length ? `<section class="sec"><div class="sec-head"><h2>プレイリスト</h2></div><div class="shelf">${state.playlists.map(plCard).join('')}</div></section>` : '');
    },
  },

  search: {
    shell() {
      return `<h1>検索</h1><label class="field">${icon('search')}<input id="q" type="search" autocomplete="off" placeholder="曲名・アーティスト、または YouTube の URL" value="${esc(search.q)}" aria-label="検索"></label>`;
    },
    mount(arg) {
      const input = $('#q');
      let timer;
      input.addEventListener('input', () => { clearTimeout(timer); const v = input.value; timer = setTimeout(() => runSearch(v), /^https?:/i.test(v) ? 0 : 400); });
      if (arg && arg !== search.q) { input.value = arg; runSearch(arg); }
      if (matchMedia('(min-width: 901px)').matches) input.focus();
    },
    body() {
      const q = search.q.trim().toLowerCase();
      const hasKey = !!state.settings.apiKey;
      if (!q) {
        return `<div class="sec panel"><h2>曲の探しかた</h2>
          <ol><li>YouTube で聴きたい公式 MV を開き、URL をコピーして上の欄に貼り付ける。再生リストの URL なら中身をまとめて取り込めます。</li>
          <li>${hasKey ? 'キーワードを入力すると、YouTube からそのまま検索できます。' : '設定で YouTube Data API キーを登録すると、キーワードでそのまま検索できます。'}</li></ol>
          <div class="actions"><button class="btn ghost" data-action="add-url">${icon('plus')}URL をまとめて追加</button>
          ${hasKey ? '' : '<a class="btn ghost" href="#/settings">検索を有効にする</a>'}</div></div>`;
      }
      const local = Object.values(state.tracks).filter(t => t.lib && (t.title + ' ' + t.artist).toLowerCase().includes(q)).map(t => t.id);
      const pls = state.playlists.filter(p => p.name.toLowerCase().includes(q));
      let out = '';
      const ext = parseExt(search.q);
      if (ext) return `<div class="sec panel"><h2>${EXT[ext.src]} の${EXT_KIND[ext.kind]}です</h2><p>このアプリのプレイリストとして引き継ぎ、${EXT[ext.src]} の公式プレーヤーでそのまま再生できます。</p><div class="actions"><button class="btn" data-action="import-ext-url" data-url="${esc(search.q.trim())}">引き継ぐ</button></div></div>`;
      if (search.list) out += `<div class="sec panel"><h2>再生リストの URL です</h2><p>中の動画をまとめてライブラリに取り込めます。</p><div class="actions"><button class="btn" data-action="import-list" data-url="${esc(search.q)}">再生リストを取り込む</button></div></div>`;
      if (search.loading) out += '<p class="empty">検索しています…</p>';
      if (search.error) out += `<p class="empty">${esc(search.error)}</p>`;
      if (search.ids.length) out += `<section class="sec"><div class="sec-head"><h2>YouTube</h2></div>${rows(search.ids, 'search')}</section>`;
      if (local.length) out += `<section class="sec"><div class="sec-head"><h2>ライブラリ内</h2></div>${rows(local, 'search:lib')}</section>`;
      if (pls.length) out += `<section class="sec"><div class="sec-head"><h2>プレイリスト</h2></div><div class="grid">${pls.map(plCard).join('')}</div></section>`;
      if (!hasKey && !search.list && !search.ids.length && !search.loading) {
        out += `<div class="sec panel"><h2>YouTube から探すには</h2><p>キーワード検索には API キーが必要です。キーなしでも、YouTube で探した動画の URL を貼れば追加できます。</p>
          <div class="actions"><a class="btn ghost" href="https://www.youtube.com/results?search_query=${encodeURIComponent(search.q + ' official MV')}" target="_blank" rel="noopener">YouTube で「${esc(search.q)}」を探す</a>
          <a class="btn ghost" href="#/settings">検索を有効にする</a></div></div>`;
      } else if (!out) out = '<p class="empty">見つかりませんでした</p>';
      return out;
    },
  },

  library: {
    shell(arg) {
      const tab = arg || 'songs';
      const tabs = [['songs', '曲'], ['playlists', 'プレイリスト'], ['artists', 'アーティスト'], ['liked', 'お気に入り']];
      const tools = tab === 'songs' || tab === 'liked' ? `<div class="tools">
        <label class="field">${icon('search')}<input id="lib-filter" type="search" placeholder="ライブラリを絞り込む" value="${esc(libFilter)}" aria-label="絞り込み"></label>
        <select id="lib-sort" aria-label="並べ替え">${[['added', '追加日が新しい順'], ['title', 'タイトル順'], ['artist', 'アーティスト順'], ['plays', '再生回数順']].map(([v, l]) => `<option value="${v}"${v === libSort ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn ghost" data-action="add-url">${icon('plus')}追加</button></div>` : '';
      return `<h1>ライブラリ</h1><div class="tabsbar">${tabs.map(([k, l]) => `<a href="#/library/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${tools}`;
    },
    mount() {
      $('#lib-filter')?.addEventListener('input', e => { libFilter = e.target.value; refresh(); });
      $('#lib-sort')?.addEventListener('change', e => { libSort = e.target.value; refresh(); });
    },
    body(arg) {
      const tab = arg || 'songs';
      const lib = libTracks();
      if (tab === 'playlists') {
        return `<div class="grid">${state.playlists.map(plCard).join('')}
          <button class="card" data-action="new-playlist"><span class="cv mosaic empty">${icon('plus')}</span><b>新しいプレイリスト</b><small>作成する</small></button>
          <button class="card" data-action="import-ext"><span class="cv mosaic empty">${icon('list')}</span><b>外部アプリから引き継ぐ</b><small>Apple Music・Spotify の共有リンク</small></button></div>`;
      }
      if (tab === 'artists') {
        const by = {};
        for (const t of lib) (by[t.artist] ||= []).push(t);
        const names = Object.keys(by).sort((a, b) => a.localeCompare(b, 'ja'));
        return names.length ? `<div class="grid">${names.map(n => `<a class="card artist" href="#/artist/${encodeURIComponent(n)}"><img class="avatar" loading="lazy" src="${thumb(by[n][0].id)}" alt=""><b>${esc(n)}</b><small>${by[n].length}曲</small></a>`).join('')}</div>`
          : '<p class="empty">ライブラリに曲を追加すると、アーティストごとに並びます</p>';
      }
      const f = libFilter.trim().toLowerCase();
      let list = lib.filter(t => (tab !== 'liked' || t.liked) && (!f || (t.title + ' ' + t.artist).toLowerCase().includes(f)));
      const cmp = {
        added: (a, b) => b.addedAt - a.addedAt, title: (a, b) => a.title.localeCompare(b.title, 'ja'),
        artist: (a, b) => a.artist.localeCompare(b.artist, 'ja') || a.title.localeCompare(b.title, 'ja'), plays: (a, b) => (b.plays || 0) - (a.plays || 0),
      }[libSort];
      list.sort(cmp);
      if (!list.length) return `<p class="empty">${f ? '一致する曲がありません' : tab === 'liked' ? 'ハートを押した曲がここに集まります' : 'まだ曲がありません。「追加」から YouTube の URL を貼り付けてください'}</p>`;
      return `<p class="sub" style="margin:0 0 8px">${list.length}曲</p>` + rows(list.map(t => t.id), 'lib:' + tab);
    },
  },

  playlist: {
    body(id) {
      const p = PL(id);
      if (!p) return '<p class="empty">このプレイリストは見つかりません</p>';
      if (p.ext) {
        const svc = EXT[p.ext.src], on = extId === p.id;
        return `<div class="hero"><div class="cover sq">${p.ext.thumb ? `<img src="${esc(p.ext.thumb)}" alt="">` : icon('list')}</div>
          <div><div class="kind">${svc} の${EXT_KIND[p.ext.kind] || 'プレイリスト'}</div><h1>${esc(p.name)}</h1><p>${svc} の音源を、公式プレーヤーでそのまま再生します</p>
          <div class="actions"><button class="btn" data-action="convert-ext" data-pl="${p.id}">${icon('play')}YouTube 版を作る（サインイン不要）</button>
            <button class="btn ghost" data-action="open-ext" data-pl="${p.id}">${on ? `${svc} のプレーヤーを表示中` : `${svc} のプレーヤーで開く`}</button>
            <a class="btn ghost" href="${esc(p.ext.page)}" target="_blank" rel="noopener">${svc} で開く</a>
            <button class="ib" data-action="pl-menu" data-pl="${p.id}" aria-label="プレイリストのメニュー">${icon('more')}</button></div></div></div>
          <div class="panel"><h2>サインインなしで全曲聴く：YouTube 版を作る</h2>
            <p>このプレイリストの曲名を読み取り、YouTube の公式動画を 1 曲ずつ探して、同じ曲順の、このアプリのプレイリストを作ります。できたプレイリストは、並べ替え・キュー・おすすめなど、このアプリの機能がすべて使えます。</p>
            <ol><li>設定で YouTube Data API キー（無料）を登録しておく必要があります。</li>
            <li>探せるのは 1 日およそ 100 曲までです。残りは、明日以降にアプリを開くと続きから自動で再開します。</li>
            <li>公式動画がない曲は、別の動画になったり、見つからなかったりします。あとから差し替えられます。</li></ol></div>
          <div class="panel"><h2>${svc} の音源のまま聴く：${svc} のプレーヤー</h2>
            <p>再生パネルに ${svc} の公式プレーヤーを表示します。サインインなしでは各曲 30 秒ほどの試聴で、プレーヤー内でサインインすると契約があれば全曲聴けます。操作はプレーヤー内のボタンで行います。</p></div>`;
      }
      p.ids = p.ids.filter(T);
      const total = p.ids.reduce((s, x) => s + (T(x).dur || 0), 0);
      return `<div class="hero"><div class="cover">${mosaic(p.ids).replace('class="cv ', 'style="height:100%;margin:0;border-radius:0" class="cv ')}</div>
        <div><div class="kind">プレイリスト${p.convFrom ? `（${/spotify/.test(p.convFrom) ? 'Spotify' : 'Apple Music'} から引き継ぎ）` : ''}</div><h1>${esc(p.name)}</h1><p>${p.ids.length}曲${total ? '・' + fmtTotal(total) : ''}</p>
        <div class="actions"><button class="btn" data-action="play-all" data-ctx="pl:${p.id}">${icon('play')}再生</button>
          <button class="btn ghost" data-action="play-all" data-ctx="pl:${p.id}" data-shuffle="1">${icon('shuffle')}シャッフル</button>
          <button class="btn ghost" data-action="add-url" data-pl="${p.id}">${icon('plus')}URL で追加</button>
          <button class="ib" data-action="pl-menu" data-pl="${p.id}" aria-label="プレイリストのメニュー">${icon('more')}</button></div></div></div>`
        + convPanel(p)
        + (p.ids.length ? rows(p.ids, 'pl:' + p.id, true) : (reg('pl:' + p.id, []), p.conv ? '' : '<p class="empty">曲の「…」メニューの「プレイリストに追加」から曲を入れられます</p>'));
    },
  },

  artist: {
    body(name) {
      const ids = Object.values(state.tracks).filter(t => t.artist === name).sort((a, b) => (b.plays || 0) - (a.plays || 0)).map(t => t.id);
      return `<div class="hero">${ids.length ? `<div class="cover round"><img src="${thumb(ids[0])}" alt=""></div>` : ''}
        <div><div class="kind">アーティスト</div><h1>${esc(name)}</h1><p>${ids.length}曲</p>
        <div class="actions">${ids.length ? `<button class="btn" data-action="play-all" data-ctx="artist">${icon('play')}再生</button>
          <button class="btn ghost" data-action="play-all" data-ctx="artist" data-shuffle="1">${icon('shuffle')}シャッフル</button>` : ''}
          ${state.settings.apiKey ? `<a class="btn ghost" href="#/search/${encodeURIComponent(name)}">${icon('search')}YouTube でもっと探す</a>` : ''}</div></div></div>`
        + (ids.length ? rows(ids, 'artist') : '<p class="empty">このアーティストの曲はまだありません</p>');
    },
  },

  settings: {
    shell() {
      return `<h1>設定</h1>
        <div class="panel"><h2>YouTube 検索（任意）</h2>
          <p>YouTube Data API v3 のキーを登録すると、アプリ内でキーワード検索と YouTube からのおすすめが使えます。キーはこのブラウザの中にだけ保存され、YouTube への検索以外には送られません。</p>
          <ol><li><a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener"><u>Google Cloud Console</u></a> で「YouTube Data API v3」を有効にする</li>
          <li>「認証情報」から API キーを作成し、下に貼り付ける</li><li>無料枠は 1 日あたり検索およそ 100 回です</li></ol>
          <div class="tools"><input class="input" id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="API キー" value="${esc(state.settings.apiKey)}" style="flex:1;min-width:200px;height:38px" aria-label="API キー">
          <button class="btn" data-action="save-key">保存</button></div></div>
        <div class="panel"><h2>データ</h2><p>ライブラリ・プレイリスト・履歴はこのブラウザに保存されています。別の端末へ移すときや、控えを取るときは書き出してください（API キーは含まれません）。</p>
          <div class="actions"><button class="btn ghost" data-action="export">書き出す</button><button class="btn ghost" data-action="import">読み込む</button>
          <button class="btn ghost" data-action="clear-history">再生履歴を消す</button><button class="btn danger" data-action="reset">すべて消去</button></div>
          <input type="file" id="import-file" accept="application/json,.json" hidden></div>
        <div class="panel"><h2>外出先で使う</h2>
          <p>次のアドレスは、パソコンを起動していなくても、どこからでも開けます。スマホではブラウザのメニューから「ホーム画面に追加」しておくと便利です。</p>
          <p><b style="font-size:18px;color:var(--text);user-select:all">${esc(PUBLIC_URL)}</b></p>
          <p>外部アプリのプレイリストから YouTube 版を作る機能だけは、パソコンで起動した music で使ってください。</p></div>
        <div class="panel"><h2>${HOSTED ? 'データを移す' : '家の Wi-Fi でスマホから開く'}</h2><div id="phone-info">${HOSTED ? '' : '<p>確認しています…</p>'}</div>
          <p>ライブラリやプレイリストは端末ごとに別々に保存されます。開くアドレスが違う場合も別々です。内容を移すには、上の「書き出す」で作ったファイルを移す先の端末に送り、そちらで「読み込む」を使ってください。API キーは端末ごとに入れ直します。</p></div>
        <div class="panel"><h2>このアプリについて</h2><p>再生には YouTube の公式埋め込みプレーヤーを使っています。動画の保存や音声の抜き出しは行いません。YouTube の規約により映像は常に表示され、広告が入ることがあります。投稿者が埋め込みを許可していない動画は再生できません。</p></div>`;
    },
    mount() {
      const onPc = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      if (!HOSTED) fetch('/api/info').then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(info => {
        const el = $('#phone-info'); if (!el) return;
        el.innerHTML = !onPc ? '<p>いまスマホなど、パソコン以外の端末から開いています。パソコン側のこのアプリを起動している間だけ使えます。</p>'
          : info.phoneUrl ? `<p>パソコンと同じ Wi-Fi につないだスマホのブラウザで、次のアドレスを開いてください。</p><p><b style="font-size:18px;color:var(--text);user-select:all">${esc(info.phoneUrl)}</b></p><p>開けないときは、パソコンに出る Windows ファイアウォールの確認で「プライベート ネットワーク」を許可してください。数字だけのアドレス（192.168.…:5173）で開くと YouTube が再生を断るので、必ず上のアドレスを使ってください。</p>`
          : info.lan ? '<p>パソコンのネットワーク上のアドレスが分かりません。Wi-Fi につながっているか確認してください。</p>'
          : '<p>いまはこのパソコンからだけ開ける状態です。スマホから開くには、いったん終了して、フォルダ内の <b>start_phone.bat</b> から起動し直してください。ここにスマホ用のアドレスが表示されます。</p>';
      });
      $('#import-file').addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const d = JSON.parse(await file.text());
          if (!d || typeof d.tracks !== 'object' || !Array.isArray(d.playlists)) throw 0;
          let n = 0;
          for (const t of Object.values(d.tracks)) {
            if (!t || !/^[\w-]{11}$/.test(t.id) || T(t.id)?.lib) continue;
            state.tracks[t.id] = { ...T(t.id), id: t.id, title: String(t.title || ''), artist: String(t.artist || '不明'), plays: +t.plays || 0, lib: !!t.lib, liked: !!t.liked, addedAt: +t.addedAt || now(), ...(t.dur ? { dur: +t.dur } : {}) };
            n++;
          }
          for (const p of d.playlists) {
            if (!p || !Array.isArray(p.ids)) continue;
            const ext = p.ext && parseExt(p.ext.page);
            if (ext && state.playlists.some(q => q.ext && q.ext.embed === ext.embed)) continue;
            if (ext) { delete ext.name; if (/^https:\/\//.test(p.ext.thumb || '')) ext.thumb = p.ext.thumb; }
            state.playlists.push({ id: uid(), name: String(p.name || '無題'), ids: p.ids.filter(T), at: now(), ...(ext ? { ext } : {}) });
          }
          save(); refresh(); toast(`読み込みました（曲 ${n}件、プレイリスト ${d.playlists.length}件）`);
        } catch { toast('このファイルは読み込めませんでした'); }
        e.target.value = '';
      });
    },
    body() {
      const lib = libTracks();
      return `<p class="sub" style="margin:0">ライブラリ ${lib.length}曲・プレイリスト ${state.playlists.length}件・再生履歴 ${state.history.length}件</p>`;
    },
  },
};

let lastHash = null;
function render() {
  const r = route();
  const v = views[r.name] || views.home;
  if (location.hash !== lastHash) {
    lastHash = location.hash;
    $('#view').innerHTML = (v.shell ? v.shell(r.arg) : '') + '<div id="vb"></div>';
    $('#main').scrollTop = 0;
    v.mount && v.mount(r.arg);
    document.body.classList.remove('now-open');
  }
  $('#vb').innerHTML = v.body(r.arg);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r.name));
  renderSide();
}
const refresh = () => render();

async function runSearch(q) {
  const seq = ++search.seq;
  Object.assign(search, { q, ids: [], error: '', list: null, loading: false });
  const text = q.trim();
  const { vid, list } = parseYT(text);
  if (parseExt(text)) { /* 画面側で引き継ぎの案内を出す */ }
  else if (vid || list) {
    search.list = list;
    if (vid) { search.loading = true; refresh(); await fetchMeta(vid); if (seq !== search.seq) return; search.ids = [vid]; search.loading = false; }
  } else if (text.length >= 2 && state.settings.apiKey) {
    search.loading = true; refresh();
    try { const ids = await apiSearch(text); if (seq !== search.seq) return; search.ids = ids; }
    catch (e) { if (seq !== search.seq) return; search.error = e.message; }
    search.loading = false;
  }
  if (route().name === 'search') refresh();
}

/* ---------- プレイリスト操作 ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
function newPlaylist(firstId) {
  ask('新しいプレイリスト', '名前', `プレイリスト ${state.playlists.length + 1}`, name => {
    const p = { id: uid(), name, ids: firstId ? [firstId] : [], at: now() };
    state.playlists.push(p); save();
    if (firstId) { refresh(); toast(`「${name}」を作成して追加しました`); } else location.hash = '#/playlist/' + p.id;
  });
}
function addToPlaylist(plId, id) {
  const p = PL(plId); if (!p) return;
  if (p.ext) return toast(`「${p.name}」は ${EXT[p.ext.src]} のプレイリストなので、ここからは曲を追加できません`);
  if (p.ids.includes(id)) return toast(`「${p.name}」にはすでに入っています`);
  p.ids.push(id); save(); refresh(); toast(`「${p.name}」に追加しました`);
}
function move(arr, from, to) {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
  arr.splice(to, 0, arr.splice(from, 1)[0]);
}
function moveIn(ctx, from, to) {
  if (ctx === 'queue') {
    move(state.queue, from, to);
  } else if (ctx.startsWith('pl:')) {
    const p = PL(ctx.slice(3)); if (!p) return;
    move(p.ids, from, to);
  } else return;
  save(); refresh(); renderQueue();
}

/* ---------- メニュー・モーダル・トースト ---------- */
let menuItems = [];
function openMenu(anchor, items) {
  const m = $('#menu');
  menuItems = items.filter(Boolean);
  m.innerHTML = menuItems.map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-mi="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  m.hidden = false;
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  m.querySelector('button')?.focus({ preventScroll: true });
}
const closeMenu = () => { $('#menu').hidden = true; };
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('[data-mi]'); if (!b) return;
  e.stopPropagation();
  const it = menuItems[+b.dataset.mi];
  if (!it.keep) closeMenu();
  it.fn();
});

function trackMenu(anchor, id, ctx, idx) {
  const t = T(id); if (!t) return;
  const pl = ctx && ctx.startsWith('pl:') ? PL(ctx.slice(3)) : null;
  const len = (lists[ctx] || []).length;
  openMenu(anchor, [
    { label: '次に再生', fn: () => queueNext(id) },
    { label: 'キューに追加', fn: () => queueAdd(id) },
    '-',
    { label: 'プレイリストに追加…', keep: true, fn: () => openMenu(anchor, [
      { label: '＋ 新しいプレイリスト', fn: () => newPlaylist(id) },
      ownPlaylists().length ? '-' : null,
      ...ownPlaylists().map(p => ({ label: p.name, fn: () => addToPlaylist(p.id, id) })),
    ]) },
    t.lib ? { label: 'ライブラリから削除', fn: () => { removeFromLibrary(id); refresh(); toast('ライブラリから削除しました'); } }
      : { label: 'ライブラリに追加', fn: () => { addToLibrary(id); refresh(); toast('ライブラリに追加しました'); } },
    { label: t.liked ? 'お気に入りから外す' : 'お気に入りに追加', fn: () => toggleLike(id) },
    '-',
    { label: 'アーティストを表示', fn: () => { location.hash = '#/artist/' + encodeURIComponent(t.artist); } },
    { label: 'YouTube で開く', fn: () => window.open(ytUrl(id), '_blank', 'noopener') },
    ...(pl || ctx === 'queue' ? [
      '-',
      idx > (ctx === 'queue' ? state.qi + 1 : 0) ? { label: '上へ移動', fn: () => moveIn(ctx, idx, idx - 1) } : null,
      idx < len - 1 ? { label: '下へ移動', fn: () => moveIn(ctx, idx, idx + 1) } : null,
      pl ? { label: 'このプレイリストから削除', danger: true, fn: () => { pl.ids.splice(idx, 1); save(); refresh(); } }
        : { label: 'キューから削除', danger: true, fn: () => { state.queue.splice(idx, 1); save(); renderQueue(); } },
    ] : []),
  ]);
}

function modal(html, onSubmit) {
  const m = $('#modal');
  m.innerHTML = `<form>${html}</form>`;
  m.hidden = false;
  const form = m.firstChild;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  form.addEventListener('submit', e => { e.preventDefault(); if (onSubmit(new FormData(form)) !== false) close(); });
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) close(); };
  const first = form.querySelector('input,textarea,select');
  if (first) { first.focus(); first.select && first.select(); } else form.querySelector('button[type=submit]')?.focus();
}
function ask(title, label, value, cb) {
  modal(`<h2>${esc(title)}</h2><label>${esc(label)}<input class="input" name="v" value="${esc(value)}" maxlength="80" required></label>
    <div class="actions"><button type="button" class="btn ghost" data-close>キャンセル</button><button type="submit" class="btn">決定</button></div>`,
  fd => { const v = String(fd.get('v')).trim(); if (!v) return false; cb(v); });
}
function confirmBox(title, text, okLabel, cb) {
  modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="actions"><button type="button" class="btn ghost" data-close>キャンセル</button><button type="submit" class="btn danger">${esc(okLabel)}</button></div>`, () => { cb(); });
}
function addUrlModal(plId) {
  modal(`<h2>YouTube の URL で追加</h2><p>動画または再生リストの URL を貼り付けてください。複数あるときは 1 行に 1 つ。</p>
    <textarea name="urls" rows="5" placeholder="https://www.youtube.com/watch?v=…" required></textarea>
    <label>追加先<select name="pl"><option value="">ライブラリのみ</option>${ownPlaylists().map(p => `<option value="${p.id}"${p.id === plId ? ' selected' : ''}>ライブラリ ＋「${esc(p.name)}」</option>`).join('')}</select></label>
    <div class="actions"><button type="button" class="btn ghost" data-close>キャンセル</button><button type="submit" class="btn">追加</button></div>`,
  fd => { addFromText(String(fd.get('urls')), String(fd.get('pl'))); });
}

function importExtModal() {
  modal(`<h2>外部アプリのプレイリストを引き継ぐ</h2>
    <p>Apple Music または Spotify で、プレイリストの「共有」→「リンクをコピー」で得た URL を貼り付けてください。複数あるときは 1 行に 1 つ。</p>
    <textarea name="urls" rows="4" placeholder="https://music.apple.com/jp/playlist/…" required></textarea>
    <p>曲はそのアプリ自身の音源で再生されます。全曲を聴くには、プレーヤー内でそのアプリにサインインします。</p>
    <div class="actions"><button type="button" class="btn ghost" data-close>キャンセル</button><button type="submit" class="btn">引き継ぐ</button></div>`,
  fd => { importExt(String(fd.get('urls'))); });
}

let toastTimer;
function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- 操作の振り分け ---------- */
const actions = {
  'play-ctx'(el) {
    const ctx = el.dataset.ctx, idx = +el.dataset.idx;
    if (ctx === 'queue') { state.qi = idx; return playCurrent(); }
    playList(lists[ctx] || [], idx);
  },
  'play-all'(el) {
    const ids = lists[el.dataset.ctx] || [];
    if (!ids.length) return toast('再生できる曲がありません');
    playList(ids, 0, !!el.dataset.shuffle); updateModes();
  },
  menu(el) { trackMenu(el, el.dataset.id, el.dataset.ctx, +el.dataset.idx); },
  like(el) { toggleLike(el.dataset.id); updateNow(); },
  'like-current'() { if (current) { toggleLike(current); updateNow(); } },
  'lib-add'(el) { addToLibrary(el.dataset.id); refresh(); toast('ライブラリに追加しました'); },
  artist(el) { if (el.dataset.name) location.hash = '#/artist/' + encodeURIComponent(el.dataset.name); },
  'new-playlist'() { newPlaylist(); },
  'pl-add-menu'(el) {
    openMenu(el, [
      { label: '新しいプレイリストを作成', fn: () => newPlaylist() },
      { label: 'Apple Music などから引き継ぐ', fn: importExtModal },
    ]);
  },
  'import-ext'() { importExtModal(); },
  'import-ext-url'(el) { importExt(el.dataset.url); },
  'open-ext'(el) { openExt(el.dataset.pl); },
  'convert-ext'(el) { convertExt(el.dataset.pl); },
  'run-conv'(el) { runConv(el.dataset.pl); },
  'conv-dismiss'(el) {
    const p = PL(el.dataset.pl); if (!p || !p.conv) return;
    p.conv.tracks = p.conv.tracks.filter(t => !t.miss);
    if (!convLeft(p)) delete p.conv;
    save(); refresh();
  },
  'close-ext'() { closeExt(); },
  'add-url'(el) { addUrlModal(el.dataset.pl); },
  'import-list'(el) { addFromText(el.dataset.url, null, true); },
  async samples() { const ids = await addFromText(SAMPLE_IDS.join('\n')); if (ids.length) location.hash = '#/library/songs'; },
  'pl-menu'(el) {
    const p = PL(el.dataset.pl); if (!p) return;
    openMenu(el, [
      { label: '名前を変更', fn: () => ask('プレイリスト名を変更', '名前', p.name, v => { p.name = v; save(); refresh(); }) },
      p.ext ? null : { label: 'すべてキューに追加', fn: () => { if (!current) return playList(p.ids); state.queue.push(...p.ids); save(); renderQueue(); toast('キューに追加しました'); } },
      '-',
      { label: 'プレイリストを削除', danger: true, fn: () => confirmBox('プレイリストを削除', p.ext ? `「${p.name}」をこのアプリから外します。${EXT[p.ext.src]} 側のプレイリストは消えません。` : `「${p.name}」を削除します。曲はライブラリに残ります。`, '削除', () => {
        if (extId === p.id) closeExt();
        state.playlists = state.playlists.filter(x => x !== p); save(); location.hash = '#/library/playlists'; toast('削除しました');
      }) },
    ]);
  },
  toggle, next() { next(false); }, prev,
  shuffle() { setShuffle(!state.settings.shuffle); toast(state.settings.shuffle ? 'シャッフル：オン' : 'シャッフル：オフ'); },
  repeat() { state.settings.repeat = { off: 'all', all: 'one', one: 'off' }[state.settings.repeat]; save(); updateModes(); toast($('#btn-repeat').title); },
  'toggle-now'() { document.body.classList.toggle('now-open'); },
  'queue-clear'() { state.queue = state.queue.slice(0, state.qi + 1); save(); renderQueue(); },
  'save-key'() {
    state.settings.apiKey = $('#api-key').value.trim(); searchCache.clear(); Object.assign(remote, { artist: null, ids: [], failed: false });
    save(); toast(state.settings.apiKey ? 'API キーを保存しました' : 'API キーを削除しました');
  },
  export() {
    const { settings, queue, qi, ...data } = state;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `music-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import() { $('#import-file').click(); },
  'clear-history'() {
    confirmBox('再生履歴を消す', '最近再生した曲と再生回数を消します。ライブラリとプレイリストは残ります。', '消す', () => {
      state.history = []; for (const t of Object.values(state.tracks)) { t.plays = 0; delete t.last; }
      save(); refresh(); toast('再生履歴を消しました');
    });
  },
  reset() {
    confirmBox('すべて消去', 'ライブラリ・プレイリスト・履歴・設定をすべて消します。元に戻せません。', 'すべて消去', () => {
      clearTimeout(saveTimer); localStorage.removeItem(KEY); location.hash = '#/home'; location.reload();
    });
  },
};

document.addEventListener('click', e => {
  if (!e.target.closest('#menu')) closeMenu();
  const el = e.target.closest('[data-action]');
  if (!el || el.closest('#menu')) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('contextmenu', e => {
  const el = e.target.closest('.row[data-ctx], .card[data-ctx]'); if (!el) return;
  const id = (lists[el.dataset.ctx] || [])[+el.dataset.idx]; if (!id) return;
  e.preventDefault();
  trackMenu({ x: e.clientX, y: e.clientY }, id, el.dataset.ctx, +el.dataset.idx);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMenu(); if (!$('#modal').hidden) { $('#modal').hidden = true; $('#modal').innerHTML = ''; } return; }
  if (e.target.closest('input,textarea,select,[contenteditable]') || !$('#modal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && !e.target.closest('button,a')) { e.preventDefault(); toggle(); }
  if (e.key === '/') { e.preventDefault(); location.hash = '#/search'; setTimeout(() => $('#q')?.focus(), 0); }
});
$('#main').addEventListener('scroll', closeMenu, { passive: true });

/* 並べ替え（プレイリストとキュー）と、サイドバーのプレイリストへのドロップ */
let drag = null;
document.addEventListener('dragstart', e => {
  const r = e.target.closest?.('.row[data-ctx]'); if (!r) return;
  const ctx = r.dataset.ctx, idx = +r.dataset.idx;
  drag = { ctx, idx, id: (lists[ctx] || [])[idx] };
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', drag.id ? ytUrl(drag.id) : '');
  r.classList.add('dragging');
});
const clearOver = () => document.querySelectorAll('.over,.drop').forEach(x => x.classList.remove('over', 'drop'));
document.addEventListener('dragover', e => {
  if (!drag) return;
  const r = e.target.closest?.('.row[data-ctx]'), side = e.target.closest?.('#side-playlists li[data-pl]');
  clearOver();
  if (r && r.dataset.ctx === drag.ctx && r.draggable) { e.preventDefault(); r.classList.add('over'); }
  else if (side) { e.preventDefault(); side.classList.add('drop'); }
});
document.addEventListener('drop', e => {
  if (!drag) return;
  const r = e.target.closest?.('.row[data-ctx]'), side = e.target.closest?.('#side-playlists li[data-pl]');
  if (r && r.dataset.ctx === drag.ctx && r.draggable) {
    e.preventDefault();
    const to = +r.dataset.idx;
    moveIn(drag.ctx, drag.idx, drag.idx < to ? to - 1 : to);
  } else if (side && drag.id) { e.preventDefault(); addToPlaylist(side.dataset.pl, drag.id); }
});
document.addEventListener('dragend', () => { drag = null; clearOver(); document.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); });

/* シークと音量 */
const seekEl = $('#seek'), volEl = $('#vol');
seekEl.addEventListener('input', () => { seeking = true; setRange(seekEl, seekEl.value); if (ytReady && current) $('#t-cur').textContent = fmt(yt.getDuration() * seekEl.value / 1000); });
seekEl.addEventListener('change', () => { if (ytReady && current) yt.seekTo(yt.getDuration() * seekEl.value / 1000, true); seeking = false; });
volEl.addEventListener('input', () => { state.settings.volume = +volEl.value; setRange(volEl, volEl.value); if (ytReady) { yt.unMute(); yt.setVolume(state.settings.volume); } save(); });

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (k, f) => { try { ms.setActionHandler(k, f); } catch { /* 未対応の操作 */ } };
  set('play', () => ytReady && yt.playVideo()); set('pause', () => ytReady && yt.pauseVideo());
  set('nexttrack', () => next(false)); set('previoustrack', prev);
}

/* ---------- 起動 ---------- */
document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
setRange(volEl, state.settings.volume);
updateModes(); updateNow();
addEventListener('hashchange', render);
if (!location.hash) history.replaceState(null, '', '#/home');
render();
loadYT();
/* 検索枠が尽きて止まっていた置き換えを、時間が経っていれば続きから再開する */
setTimeout(() => {
  const p = state.playlists.find(q => convLeft(q) && (!q.conv.stopped || now() - q.conv.stopped > 6 * 36e5));
  if (p && state.settings.apiKey) runConv(p.id);
}, 4000);
