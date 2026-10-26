# 赋遍繁穹 · f8cloud

> 诗云 · 飞八分钱

灵感来自刘慈欣的小说《诗云》：神穷举了所有可能的诗，把它们铺满整个星空，却无法从中挑出好诗。

本项目是一个纯前端的"吟诗"网站：生成四句七言诗，每个汉字的拼音首字母必须逐字符合固定模板——

```
F B F Q G F M
G D F M X H H
F B F Z J Z Q
F M Y J B B X
```

第一句的 FBFQ 即"飞八分钱"，也是"赋遍繁穹"的首字母。

## 功能

- **诗云模式**：每个位置在合式的常用字中均匀随机，几乎全是乱码——这就是诗云的原貌。每首诗都有唯一编号，可凭编号寻回。
- **成诗模式**：以全唐诗的二字组统计为依据，在首字母约束下采样出"像诗"的句子；可填写语境，引擎会优先选用相关的字词。
- **寻诗**：输入编号寻回一首诗；输入自己写的诗，逐字校验首字母并反查编号。
- **补字**：点选模板格子，列出合式的候选字与词，亲手写出自己的那一首。
- **诗有穷，云无尽**：当前模板下共约 1.5×10⁶³ 首诗，全部存下来需要约 10⁸ 个太阳的原子。

## 使用

直接用浏览器打开 `index.html` 即可，无需构建、无需联网。

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 界面（古风 UI） |
| `engine.js` | 生成引擎，接口见 [docs/ui-prompt.md](docs/ui-prompt.md) |
| `data.js` | 由 `build_data.py` 生成的字表、词表与语境联想数据 |
| `build_data.py` | 数据构建脚本 |

重新生成数据：

```bash
pip install pypinyin jieba zhconv
python build_data.py   # 首次运行会把全唐诗下载到 corpus/
```

## 说明

- 字集为 GB2312 一级常用字（3755 字）。多音字只计入其常用读音（默认读音及在词组中常见的读音）。
- 诗的编号是 28 位混合进制数，只依赖字表顺序；若重新生成数据导致字表变化，旧编号将指向不同的诗。

## 致谢

- 刘慈欣《诗云》
- [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT）
- [pypinyin](https://github.com/mozillazg/python-pinyin)（MIT）
- [jieba](https://github.com/fxsjy/jieba)（MIT）
- [zhconv](https://github.com/gumblex/zhconv)

## 协议

MIT
