你是一名擅长中国古典美学的前端设计师。请为一个开源纯前端网站「赋遍繁穹」（英文名 f8cloud）制作 UI。

## 项目背景

灵感来自刘慈欣小说《诗云》：神穷举了所有可能的诗，把它们铺满整个星空，却无法从中挑出好诗。
「赋遍繁穹」即"把诗赋写遍整个苍穹"。副标题：诗云 · 飞八分钱。
英文名 f8cloud：f8 即"飞八"，cloud 即"诗云"。页面标题用「赋遍繁穹 · f8cloud」，印章与主标题用中文名。

网站生成四句七言诗，每个汉字的拼音首字母必须逐字符合一个固定的预设模板：

    F B F Q G F M
    G D F M X H H
    F B F Z J Z Q
    F M Y J B B X

（第一句前四个字母 FBFQ 即"飞八分钱"，也即项目名"赋遍繁穹"的首字母。）
模板固定不可编辑，但请从 engine 读取，不要写死在 UI 里。

## 技术约束

- 只交付一个 index.html，CSS/JS 全部内联；不得引入任何外部库、CDN、在线字体或网络请求。
- 页面通过下面两行加载数据与引擎，你只调用引擎接口，不要自己实现生成逻辑：
      <script src="data.js"></script>
      <script src="engine.js"></script>
- 为了能独立预览，请在 index.html 内写一个 mock 引擎，签名与下方接口完全一致；
  仅当 window.F8Cloud 不存在时启用 mock。mock 生成的字不必符合首字母规则。
- 字体只用系统字体栈：
  "Kaiti SC","STKaiti","KaiTi","Songti SC","STSong","SimSun","Noto Serif CJK SC",serif
- 适配手机（竖屏下诗句仍以竖排为主，必要时可切横排）。
- 支持 prefers-color-scheme 的「夜读」深色模式，并提供手动切换。
- 键盘可操作，按钮有 aria-label。

## 引擎接口 window.F8Cloud

数据类型：

    Char  = { ch: string, py: string /* 带声调拼音 */, initial: string /* 小写首字母 */ }
    Poem  = { lines: Char[7][4], index: string /* 十进制大整数字符串 */, mode: "cloud" | "verse" }

接口：

- F8Cloud.name -> { zh: "赋遍繁穹", en: "f8cloud" }
- F8Cloud.preset -> ["fbfqgfm", "gdfmxhh", "fbfzjzq", "fmyjbbx"]
- F8Cloud.generate({ mode, context?, base?, locked? }) -> Poem
    - mode: "cloud" 纯随机（诗云原貌，多为乱码）；"verse" 用词语成诗（较通顺）
    - context: 用户输入的语境文字，引擎会优先选用相关的字词
    - base + locked: 传入当前的诗和 [bool,bool,bool,bool]，被锁定的句子保持不变
- F8Cloud.regenerateLine(poem, lineNo /* 0-3 */, { mode, context? }) -> Poem
- F8Cloud.fromIndex(index: string) -> Poem | null      // 编号超出范围时为 null
- F8Cloud.toIndex(text: string) -> string | null       // 输入一首诗（28 字，可含标点换行），不符合模板时为 null
- F8Cloud.validate(text: string) -> { ok: boolean, errors: [{ line, pos, ch, expected, got }] }
- F8Cloud.stats() -> { count: string, countSci: string, bytes: string, bytesSci: string,
                    suns: string, earths: string }
- F8Cloud.candidates(lineNo, pos, length /* 1-4 */) -> { chars: [{ch, py}], words: [{w, py}] }
    // 当前预设下，第 lineNo 句从 pos 开始 length 个位置的候选字/词，按常用度排序

## 页面需求

1. 主体：四句诗以竖排（writing-mode: vertical-rl，从右向左）书写在宣纸卷轴上。
   每字可用 <ruby> 注拼音，并高亮首字母；注音可开关。
2. 操作：「吟一首」（生成）、每句「重吟」与「锁定」、复制全诗、分享
   （把编号写入 URL hash，如 #n=12345，打开链接即复现该诗）。
3. 模式切换：「诗云」（纯随机，展示该诗在诗云中的编号）与「成诗」（词语拼接）。
   用一句话说明两者区别：诗云包罗一切而几无可读，成诗可读而只是诗云一隅。
4. 语境：一个输入框，用户写下想吟咏的情境或关键字，生成时传给 context。
5. 编号检索：输入编号跳转到对应的诗；输入一首自己写的诗，校验首字母并反查其编号，
   逐字标出不符合的位置（用 validate）。
6. 填字助手：展示 4×7 的首字母格子，点击某格或选中一段格子，列出候选字与词，
   点击即可填入，让人亲手写出自己的那一首。
7. 诗云统计：展示该模板下诗的总数、全部存储所需字节、相当于多少个太阳/地球的原子，
   用小说式庄严、克制的口吻呈现。
8. 页脚：开源仓库链接占位、MIT 协议、致敬刘慈欣《诗云》（只做意境引用，不要大段引用原文）。

## 美学方向（请充分发挥你自己对古风的理解）

宣纸纹理与大量留白；朱红印章（用 CSS/SVG 绘制「赋遍繁穹」方印，盖在诗末）；
卷轴展开、墨迹晕开或字迹逐字浮现的动画；克制的配色（墨、赭、朱、月白、黛青）；
按钮可做成签条、竹简或小印样式；"诗云"的意象可以用淡淡的、由字组成的云或星空作背景。
避免廉价渐变、霓虹色和过度装饰，追求雅致、安静、有书卷气。
动画需尊重 prefers-reduced-motion。

## 交付

1. 完整的 index.html。
2. 一段简短说明：设计取舍、配色值、可调整的 CSS 变量。
