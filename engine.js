/*
 * f8cloud engine · 赋遍繁穹
 * 接口见 docs/ui-prompt.md。依赖 data.js 提供的 window.F8_DATA。
 *
 * 诗云模式：28 个位置各自在"该首字母的常用字"中均匀随机；
 *           每首诗对应一个混合进制编号（第一个字为最高位），可双向换算。
 * 成诗模式：以全唐诗的二字组频率为转移权重，在首字母约束下做
 *           前向过滤、后向采样（FFBS），多次采样后按词组、尾句、语境、重字重新打分择优。
 * 编号只依赖字表（GB2312 一级字在各首字母下的顺序），与生成模式无关。
 */
(function () {
  'use strict';
  const D = window.F8_DATA;
  if (!D) { console.error('[f8cloud] 缺少 data.js'); return; }

  const preset = D.preset.slice();
  const NUMS = '一二三四五六七';

  // ---------- 字表 ----------
  const groups = {};
  for (const [k, g] of Object.entries(D.groups)) {
    const chars = Array.from(g.chars), py = g.py.split(' ');
    const index = new Map(chars.map((c, i) => [c, i]));
    groups[k] = { k, chars, py, freq: g.freq, index };
  }
  const slots = preset.map(s => Array.from(s, k => groups[k]));
  const flat = slots.flat();
  const count = flat.reduce((n, g) => n * BigInt(g.chars.length), 1n);

  // ---------- 词表 ----------
  // words[key] : Map(词 -> {py, c: 唐诗次数, j: jieba 词频})
  const words = {};
  for (const [key, list] of Object.entries(D.words)) {
    const m = new Map();
    for (const [w, py, c, j] of list) m.set(w, { py, c, j });
    words[key] = m;
  }
  const tails = D.lines.map(l => new Map(l.tail.map(([w, py, c]) => [w, { py, c }])));
  const starts = D.lines.map(l => new Map(l.start.map(([w, py, c]) => [w, { py, c }])));
  const ends = D.lines.map(l => new Map(l.end.map(([w, py, c]) => [w, { py, c }])));
  const fulls = D.lines.map(l => l.full.map(([w, py, c]) => ({ w, py, c })));
  const wordAt = (l, p, w) => words[preset[l].slice(p, p + w.length)]?.get(w);

  // ---------- 工具 ----------
  const clean = t => Array.from(String(t || '').replace(/[\s\p{P}]/gu, ''));
  const rand = () => {
    if (window.crypto?.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
    return Math.random();
  };
  const randInt = n => Math.floor(rand() * n);
  const lse = arr => { let m = -Infinity; for (const x of arr) if (x > m) m = x; if (m === -Infinity) return m; let s = 0; for (const x of arr) s += Math.exp(x - m); return m + Math.log(s); };
  function sampleLog(scores) {
    const m = Math.max(...scores); let total = 0; const w = scores.map(s => { const e = Math.exp(s - m); total += e; return e; });
    let r = rand() * total; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1;
  }
  const sci = n => { const s = n.toString(); return s[0] + '.' + s.slice(1, 5).padEnd(4, '0') + 'e' + (s.length - 1); };
  // BigInt 除以浮点数，结果用科学计数法字符串表示
  function divSci(big, divisor) {
    const s = big.toString(), e = s.length - 1, mant = Number(s.slice(0, 16)) / 1e15;
    const v = mant / divisor, ve = Math.floor(Math.log10(v)), m = v / Math.pow(10, ve);
    return m.toFixed(3) + 'e' + (e + ve);
  }

  // 拼音标注：每句按最长词匹配取整词读音，否则取该字在此首字母下的读音
  function charAt(l, p, ch) {
    const g = slots[l][p], i = g.index.get(ch);
    return { ch, py: i === undefined ? '' : g.py[i], initial: g.k };
  }
  function annotate(l, chars) {
    const out = chars.map((ch, p) => charAt(l, p, ch));
    for (let p = 0; p < chars.length;) {
      let step = 1;
      for (let n = Math.min(4, chars.length - p); n >= 2; n--) {
        const w = chars.slice(p, p + n).join('');
        const hit = wordAt(l, p, w) || (p === 4 && n === 3 ? tails[l].get(w) : null);
        if (hit) { hit.py.split(' ').forEach((py, i) => { out[p + i].py = py; }); step = n; break; }
      }
      p += step;
    }
    return out;
  }

  // ---------- 编号 ----------
  function encodeChars(all) {
    let n = 0n;
    for (let i = 0; i < 28; i++) {
      const k = flat[i].index.get(all[i]);
      if (k === undefined) return null;
      n = n * BigInt(flat[i].chars.length) + BigInt(k);
    }
    return n.toString();
  }
  function decode(index) {
    if (!/^\d+$/.test(String(index))) return null;
    let n = BigInt(index);
    if (n >= count) return null;
    const all = new Array(28);
    for (let i = 27; i >= 0; i--) { const r = BigInt(flat[i].chars.length); all[i] = flat[i].chars[Number(n % r)]; n /= r; }
    return [0, 1, 2, 3].map(l => all.slice(l * 7, l * 7 + 7));
  }

  // ---------- 语境 ----------
  function contextWeights(context) {
    const w = new Map();
    for (const c of clean(context)) {
      if (!D.initials[c]) continue;
      w.set(c, Math.max(w.get(c) || 0, 4));
      for (const r of D.related[c] || '') w.set(r, Math.max(w.get(r) || 0, 1.5));
    }
    return w;
  }

  // ---------- 成诗：FFBS ----------
  // 七言节奏 2|2|3：词内相邻强，词间相邻弱
  const STRENGTH = [1.6, 0.6, 1.6, 0.5, 1.2, 1.2];
  const MISS = [-4, -0.8, -4, -0.6, -2.2, -2.2];
  const lineModelCache = new Map();

  function lineModel(l, ctx, ctxKey) {
    const cacheKey = l + '|' + ctxKey;
    if (lineModelCache.has(cacheKey)) return lineModelCache.get(cacheKey);
    const s = preset[l];
    const cand = [], pos = [];
    for (let p = 0; p < 7; p++) {
      const g = slots[l][p], list = [], map = new Map();
      g.chars.forEach((ch, i) => {
        const f = g.freq[i], cw = ctx.get(ch) || 0;
        if (f < 30 && !cw) return;
        map.set(ch, list.length);
        list.push({ ch, u: 0.25 * Math.log(1 + f) + cw });
      });
      cand.push(list); pos.push(map);
    }
    // pairs[p] : Map(a*1024+b -> 分值)，inc[p][b] : [[a, 分值]]
    const pairs = [], inc = [];
    for (let p = 0; p < 6; p++) {
      const m = new Map(), into = cand[p + 1].map(() => []);
      const ws = new Map(words[s.slice(p, p + 2)] || []);
      // 句首两字、句末两字另有专门统计：句末用"诗句结尾"的二字组，避免"不相"这类收不住的结尾
      const special = p === 0 ? starts[l] : p === 5 ? ends[l] : null;
      if (special) for (const [w, e] of special) if (!ws.has(w)) ws.set(w, { c: 0, j: 0 });
      for (const [w, e] of ws) {
        const [a, b] = Array.from(w), ia = pos[p].get(a), ib = pos[p + 1].get(b);
        if (ia === undefined || ib === undefined) continue;
        const sp = special?.get(w)?.c || 0;
        let sc = e.c > 0 ? STRENGTH[p] * Math.log(1 + e.c) : 0.4 * STRENGTH[p];
        if (p === 5) sc = sp ? 1.8 * Math.log(1 + sp) + 0.3 * Math.log(1 + e.c) : MISS[p] + 0.3 * Math.log(1 + e.c);
        else if (sp) sc += 0.8 * Math.log(1 + sp);
        m.set(ia * 1024 + ib, sc); into[ib].push([ia, sc]);
      }
      pairs.push(m); inc.push(into);
    }
    const model = { cand, pos, pairs, inc };
    if (lineModelCache.size > 64) lineModelCache.clear();
    lineModelCache.set(cacheKey, model);
    return model;
  }

  function sampleLine(model, T) {
    const { cand, pairs, inc } = model;
    const alpha = [cand[0].map(c => c.u / T)];
    for (let p = 1; p < 7; p++) {
      const prev = alpha[p - 1], base = lse(prev) + MISS[p - 1] / T;
      alpha.push(cand[p].map((c, x) => {
        const terms = [base];
        for (const [y, sc] of inc[p - 1][x]) terms.push(prev[y] + sc / T);
        return c.u / T + lse(terms);
      }));
    }
    const idx = new Array(7);
    idx[6] = sampleLog(alpha[6]);
    for (let p = 5; p >= 0; p--) {
      const nx = idx[p + 1], m = pairs[p];
      idx[p] = sampleLog(alpha[p].map((a, y) => a + (m.get(y * 1024 + nx) ?? MISS[p]) / T));
    }
    return idx.map((i, p) => cand[p][i].ch);
  }

  function scoreLine(l, chars, model, ctx, used) {
    let s = 0;
    for (let p = 0; p < 7; p++) s += model.cand[p][model.pos[p].get(chars[p])].u;
    for (let p = 0; p < 6; p++) s += model.pairs[p].get(model.pos[p].get(chars[p]) * 1024 + model.pos[p + 1].get(chars[p + 1])) ?? MISS[p];
    const tail = chars.slice(4).join('');
    if (tails[l].has(tail)) s += 3 + Math.log(1 + tails[l].get(tail).c);
    for (const [p, n] of [[0, 4], [2, 3], [4, 3], [0, 3]]) {
      const e = wordAt(l, p, chars.slice(p, p + n).join(''));
      if (e && e.c >= 2) s += 1.2;
    }
    const seen = new Set();
    for (const c of chars) { if (seen.has(c) || used.has(c)) s -= 2.5; seen.add(c); }
    return s;
  }

  // 近期吟过的句子与二字组：再次出现时降权，使连续"吟一首"不至于反复同一句
  const recentLines = [], recentPairs = new Map();
  function remember(chars) {
    const text = chars.join('');
    recentLines.push(text);
    for (let p = 0; p < 6; p++) { const k = chars[p] + chars[p + 1]; recentPairs.set(k, (recentPairs.get(k) || 0) + 1); }
    if (recentLines.length > 24) {
      const old = Array.from(recentLines.shift());
      for (let p = 0; p < 6; p++) { const k = old[p] + old[p + 1], n = recentPairs.get(k) - 1; if (n > 0) recentPairs.set(k, n); else recentPairs.delete(k); }
    }
  }
  function novelty(chars) {
    let s = recentLines.includes(chars.join('')) ? -6 : 0;
    for (let p = 0; p < 6; p++) s -= 1.2 * Math.min(3, recentPairs.get(chars[p] + chars[p + 1]) || 0);
    return s;
  }

  function verseLine(l, ctx, ctxKey, used) {
    // 少量概率直接集句：全唐诗中恰好合式的整句
    const full = fulls[l];
    if (full.length && rand() < 0.08) return Array.from(full[randInt(full.length)].w);
    const model = lineModel(l, ctx, ctxKey);
    const tries = [];
    for (let i = 0; i < 32; i++) {
      const chars = sampleLine(model, 1.3);
      tries.push({ chars, score: scoreLine(l, chars, model, ctx, used) + novelty(chars) });
    }
    const chosen = tries[sampleLog(tries.map(t => t.score))].chars;
    remember(chosen);
    return chosen;
  }

  function cloudLine(l, ctx) {
    return slots[l].map(g => {
      const hits = g.chars.filter(c => (ctx.get(c) || 0) >= 4);
      if (hits.length && rand() < 0.35) return hits[randInt(hits.length)];
      return g.chars[randInt(g.chars.length)];
    });
  }

  function looksLikeVerse(lines) {
    return lines.every((chars, l) => [0, 2, 4, 5].filter(p => (wordAt(l, p, chars[p] + chars[p + 1])?.c || 0) >= 2).length >= 2);
  }

  function build(lines, mode) {
    const all = lines.flat();
    return { lines: lines.map((chars, l) => annotate(l, chars)), index: encodeChars(all), mode };
  }

  // ---------- 接口 ----------
  function generate({ mode = 'verse', context = '', base = null, locked = [] } = {}) {
    const ctx = contextWeights(context), ctxKey = [...ctx.keys()].sort().join('');
    const keep = l => !!(base && locked[l]);
    const lines = [0, 1, 2, 3].map(l => keep(l) ? base.lines[l].map(c => c.ch) : null);
    const used = new Set(lines.filter(Boolean).flat());
    for (let l = 0; l < 4; l++) {
      if (lines[l]) continue;
      lines[l] = mode === 'cloud' ? cloudLine(l, ctx) : verseLine(l, ctx, ctxKey, used);
      lines[l].forEach(c => used.add(c));
    }
    const poem = build(lines, mode === 'cloud' ? 'cloud' : 'verse');
    if (base) [0, 1, 2, 3].forEach(l => { if (keep(l)) poem.lines[l] = base.lines[l].map(c => ({ ...c })); });
    return poem;
  }

  function regenerateLine(poem, lineNo, { mode = 'verse', context = '' } = {}) {
    return generate({ mode, context, base: poem, locked: [0, 1, 2, 3].map(l => l !== lineNo) });
  }

  function fromIndex(index) {
    let lines;
    try { lines = decode(String(index).trim()); } catch { return null; }
    if (!lines) return null;
    return build(lines, looksLikeVerse(lines) ? 'verse' : 'cloud');
  }

  function validate(text) {
    const chars = clean(text), errors = [];
    const n = Math.max(28, chars.length);
    for (let i = 0; i < n; i++) {
      const l = Math.floor(i / 7), p = i % 7, ch = chars[i];
      if (i >= 28) { errors.push({ line: l, pos: p, ch, expected: '无（多余字）', got: '多余' }); continue; }
      if (ch === undefined || ch === '□') { errors.push({ line: l, pos: p, ch: '□', expected: preset[l][p], got: '缺字' }); continue; }
      if (slots[l][p].index.has(ch)) continue;
      const ini = D.initials[ch];
      errors.push({ line: l, pos: p, ch, expected: preset[l][p], got: ini ? ini.split('').join('/') : '字库外' });
    }
    return { ok: errors.length === 0, errors };
  }

  function toIndex(text) {
    const chars = clean(text);
    if (chars.length !== 28) return null;
    return encodeChars(chars);
  }

  function stats() {
    const bytes = count * 84n; // 每首 28 字 × UTF-8 每字 3 字节
    return {
      count: count.toString(), countSci: sci(count),
      bytes: bytes.toString(), bytesSci: sci(bytes),
      suns: divSci(bytes, 1.2e57), earths: divSci(bytes, 1.33e50),
    };
  }

  function candidates(lineNo, pos, length) {
    const l = Number(lineNo), p = Number(pos), n = Number(length);
    if (!slots[l] || !Number.isInteger(p) || !Number.isInteger(n) || n < 1 || n > 4 || p < 0 || p + n > 7) return { chars: [], words: [] };
    if (n === 1) {
      const g = slots[l][p];
      const chars = g.chars.map((ch, i) => ({ ch, py: g.py[i], f: g.freq[i] }))
        .sort((a, b) => b.f - a.f).map(({ ch, py }) => ({ ch, py }));
      return { chars, words: [] };
    }
    const list = [];
    const ws = words[preset[l].slice(p, p + n)];
    if (ws) for (const [w, e] of ws) list.push({ w, py: e.py, s: e.c * 10 + e.j });
    if (p === 4 && n === 3) for (const [w, e] of tails[l]) if (!ws?.has(w)) list.push({ w, py: e.py, s: e.c * 10 });
    list.sort((a, b) => b.s - a.s);
    return { chars: [], words: list.map(({ w, py }) => ({ w, py })) };
  }

  window.F8Cloud = {
    name: { zh: '赋遍繁穹', en: 'f8cloud' },
    preset: preset.slice(),
    generate, regenerateLine, fromIndex, toIndex, validate, stats, candidates,
    statsNote: `字表为 GB2312 一级常用字中读音首字母相符者（多音字按各读音分别计入），诗的总数是一个 ${count.toString().length} 位数。存储按每首 28 字、UTF-8 每字 3 字节计；以一个原子存一个字节作比，太阳约 1.2×10⁵⁷ 个原子，地球约 1.33×10⁵⁰ 个原子。`,
  };
})();
