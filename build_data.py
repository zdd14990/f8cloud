"""
生成 f8cloud 前端数据 data.js

字集：GB2312 一级常用汉字（3755 字，本身按拼音排序）
语料：chinese-poetry 全唐诗（MIT），繁体转简体后统计词语与半句
词库：jieba 词典（MIT），补充填字助手的候选词
读音：pypinyin（MIT），按整句语境取读音，正确处理多音字

依赖：pip install pypinyin jieba zhconv
用法：python build_data.py        # 首次运行会自动下载全唐诗到 corpus/
"""
import json, math, os, re, sys, unicodedata, urllib.request
from collections import Counter, defaultdict

import jieba
import zhconv
from pypinyin import Style, lazy_pinyin, pinyin

ROOT = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(ROOT, "corpus")
OUT = os.path.join(ROOT, "data.js")
PRESET = ["fbfqgfm", "gdfmxhh", "fbfzjzq", "fmyjbbx"]
TANG_URL = ("https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/"
            "%E5%85%A8%E5%94%90%E8%AF%97/poet.tang.{}.json")
TANG_FILES = range(0, 58000, 1000)

# 每个首字母串最多保留的候选数（控制 data.js 体积）
CAP = {2: 1500, 3: 500, 4: 300}
CAP_TAIL, CAP_FULL = 1500, 300
RELATED_TOP = 16


def initial(py):
    return unicodedata.normalize("NFD", py)[0].lower()


# ---------- 1. 字集 ----------
chars = []
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        if hi == 0xD7 and lo > 0xF9:
            break
        chars.append(bytes([hi, lo]).decode("gb2312"))
charset = set(chars)
needed = set("".join(PRESET))

# 多音字只保留"实际在用"的读音：默认读音 + 在 pypinyin 词组库中至少出现 2 次的读音，
# 排除"百 mò""拔 fá"这类古僻读音，保证每个字按真实读音计入首字母组
from pypinyin.phrases_dict import phrases_dict
attested = defaultdict(Counter)
for ph, pys in phrases_dict.items():
    if len(ph) == len(pys):
        for c, py in zip(ph, pys):
            attested[c][py[0]] += 1


def readings_of(c):
    default = pinyin(c, style=Style.TONE)[0][0]
    out = [default]
    for r in pinyin(c, style=Style.TONE, heteronym=True)[0]:
        if r not in out and attested[c][r] >= 2:
            out.append(r)
    return out


# 首字母 -> [(字, 该首字母下的读音)]，保持 GB2312 顺序；编号依赖此顺序
groups = {k: [] for k in sorted(needed)}
for c in chars:
    seen = set()
    for r in readings_of(c):
        k = initial(r)
        if k in groups and k not in seen:
            seen.add(k)
            groups[k].append((c, r))
# 每个字所有读音的首字母，供校验时提示"实际首字母"
all_initials = {c: "".join(sorted({initial(r) for r in readings_of(c)})) for c in chars}
group_sets = {k: {c for c, _ in v} for k, v in groups.items()}


def fits(w, key):
    return all(c in group_sets.get(k, ()) for c, k in zip(w, key))

# ---------- 2. 全唐诗 ----------
os.makedirs(CORPUS, exist_ok=True)
for i in TANG_FILES:
    path = os.path.join(CORPUS, f"tang.{i}.json")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        print("download", path, file=sys.stderr)
        urllib.request.urlretrieve(TANG_URL.format(i), path)

subs = set()  # 预设里所有长度 2~7 的连续子串（只统计这些首字母串）
for s in PRESET:
    for n in range(2, 8):
        for p in range(0, 8 - n):
            subs.add(s[p:p + n])

ngram = Counter()            # (词, 读音) -> 次数，任意位置
head4, tail3, full7 = Counter(), Counter(), Counter()
start2, end2 = Counter(), Counter()  # 句首两字 / 句末两字
char_freq = Counter()
cooc = defaultdict(Counter)  # 字 -> 同句共现的字
clause_re = re.compile(r"[\u4e00-\u9fff]+")

poems = 0
for i in TANG_FILES:
    with open(os.path.join(CORPUS, f"tang.{i}.json"), encoding="utf8") as f:
        for poem in json.load(f):
            poems += 1
            text = zhconv.convert("".join(poem.get("paragraphs", [])), "zh-cn")
            for clause in clause_re.findall(text):
                if any(c not in charset for c in clause):
                    continue
                char_freq.update(clause)
                uniq = set(clause)
                for a in uniq:
                    cooc[a].update(uniq - {a})
                pys = lazy_pinyin(clause, style=Style.TONE)
                if len(pys) != len(clause):
                    continue
                ini = "".join(initial(p) for p in pys)
                L = len(clause)
                for n in (2, 3, 4):
                    for p in range(0, L - n + 1):
                        if ini[p:p + n] in subs:
                            ngram[(clause[p:p + n], " ".join(pys[p:p + n]))] += 1
                if L >= 4:
                    start2[(clause[:2], " ".join(pys[:2]))] += 1
                    end2[(clause[-2:], " ".join(pys[-2:]))] += 1
                if L == 7:
                    if ini[:4] in subs:
                        head4[(clause[:4], " ".join(pys[:4]))] += 1
                    if ini[4:] in subs:
                        tail3[(clause[4:], " ".join(pys[4:]))] += 1
                    if ini in PRESET:
                        full7[(clause, " ".join(pys))] += 1
print("poems", poems, file=sys.stderr)

# ---------- 3. jieba 词典（补充填字候选）----------
jieba_freq = {}
with open(os.path.join(os.path.dirname(jieba.__file__), "dict.txt"), encoding="utf8") as f:
    for line in f:
        parts = line.split()
        if len(parts) < 3:
            continue
        w, fr, pos = parts[0], int(parts[1]), parts[2]
        if not 2 <= len(w) <= 4 or fr < 10 or pos in ("m", "nr", "nrt", "nz", "eng", "x"):
            continue
        if any(c not in charset for c in w):
            continue
        jieba_freq[w] = fr

words = defaultdict(dict)  # key -> {词: [读音, 唐诗次数, jieba 对数词频]}
for (w, py), c in ngram.items():
    key = "".join(initial(p) for p in py.split())
    if fits(w, key):
        words[key][w] = [py, c, 0]
for w, fr in jieba_freq.items():
    pys = lazy_pinyin(w, style=Style.TONE)
    if len(pys) != len(w):
        continue
    key = "".join(initial(p) for p in pys)
    if key not in subs or not fits(w, key):
        continue
    e = words[key].setdefault(w, [" ".join(pys), 0, 0])
    e[2] = round(math.log10(fr) * 10)

words_out = {}
for key, d in words.items():
    # 唐诗出现 ≥2 次，或是 jieba 常用词
    items = [(w, *v) for w, v in d.items() if v[1] >= 2 or v[2] >= 20]
    items.sort(key=lambda x: -(x[2] * 10 + x[3]))
    words_out[key] = [list(x) for x in items[:CAP[len(key)]]]


def top(counter, cap, minc=1):
    lst = [(w, py, c) for (w, py), c in counter.items()
           if c >= minc and fits(w, "".join(initial(p) for p in py.split()))]
    lst.sort(key=lambda x: -x[2])
    return [list(x) for x in lst[:cap]]


lines = []
for s in PRESET:
    lines.append({
        "tail": top(Counter({k: v for k, v in tail3.items()
                             if "".join(initial(p) for p in k[1].split()) == s[4:]}), CAP_TAIL),
        "start": top(Counter({k: v for k, v in start2.items()
                              if "".join(initial(p) for p in k[1].split()) == s[:2]}), 1000),
        "end": top(Counter({k: v for k, v in end2.items()
                            if "".join(initial(p) for p in k[1].split()) == s[5:]}), 1000),
        "full": top(Counter({k: v for k, v in full7.items()
                             if "".join(initial(p) for p in k[1].split()) == s}), CAP_FULL),
    })

# ---------- 4. 语境联想：同句共现的高 PMI 字 ----------
total = sum(char_freq.values())
related = {}
for a in chars:
    if char_freq[a] < 20:
        continue
    scored = []
    for b, n in cooc[a].items():
        if n < 5 or char_freq[b] < 20:
            continue
        pmi = math.log(n * total / (char_freq[a] * char_freq[b]))
        scored.append((pmi * math.log(n), b))
    scored.sort(reverse=True)
    related[a] = "".join(b for _, b in scored[:RELATED_TOP])

out_groups = {}
for k, lst in groups.items():
    out_groups[k] = {
        "chars": "".join(c for c, _ in lst),
        "py": " ".join(r for _, r in lst),
        "freq": [char_freq[c] for c, _ in lst],
    }

data = {
    "version": 1,
    "charset": "GB2312-L1",
    "preset": PRESET,
    "groups": out_groups,
    "words": words_out,
    "lines": lines,
    "related": related,
    "initials": all_initials,
}
with open(OUT, "w", encoding="utf8") as f:
    f.write("/* f8cloud data, generated by build_data.py. Sources: GB2312, chinese-poetry (MIT), jieba (MIT), pypinyin (MIT). */\n")
    f.write("window.F8_DATA=")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print("size KB", os.path.getsize(OUT) // 1024)
print("groups", {k: len(v) for k, v in groups.items()})
for i, l in enumerate(lines):
    print(PRESET[i], "start", len(l["start"]), "end", len(l["end"]), "tail", len(l["tail"]), "full", len(l["full"]),
          "e.g.", [x[0] for x in l["full"][:5]], [x[0] for x in l["end"][:12]], [x[0] for x in l["tail"][:5]])
