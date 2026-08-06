# 勝利/失敗結算畫面 — 美術需求清單

> 交給繪圖 AI 用的規格書。生成完後存進 `card_game_png/endscreen/`(資料夾需自己新建,
> 跟之前卡圖那批一樣是本機暫存,不進 git),檔名照下面表格取,我會負責裁切/壓縮/整合進
> `web/img/`。風格錨點沿用 `tools/cardgen_source_art/README.md` 那套(已經穩定跑過 11 張卡),
> 這次只是換場景,不是新風格。

## 共用風格錨點(每個 prompt 最後都加這段)

```
digital painting, semi-realistic fantasy illustration, dramatic rim lighting,
rich saturated color, painterly brushwork, cinematic lighting, no text, no
watermark, no logo, no border, no UI elements
```

---

## 檔案清單(共 5 張)

### 1. `victory_bg.png` — 勝利背景全圖
**尺寸**:直式 1080×1920(9:16),主體置中偏上,下半留空給文字/按鈕。
**用途**:結算畫面滿版背景。
**Prompt**:
```
A radiant celebratory scene: a brilliant golden sun bursting with radiating
light beams from the center, warm gold and amber tones, sparkling motes of
light drifting upward like embers, a few thin astrological chart lines and
faint constellation dots visible near the edges, deep midnight-blue sky
fading to near-black at the top and bottom edges for contrast, portrait
orientation, plenty of empty breathing room in the lower third of the frame.
```
+ 風格錨點

### 2. `defeat_bg.png` — 失敗背景全圖
**尺寸**:同上,1080×1920,下半留空。
**用途**:結算畫面滿版背景(戰敗版)。
**Prompt**:
```
A somber defeat scene: a dim, partially eclipsed moon glowing cold pale blue,
weak light filtering through drifting dark storm clouds, a cracked dry
ground fading into shadow far below, a few dying embers or ash drifting in
the air, deep near-black indigo sky, muted desaturated colors except for the
pale moonlight, portrait orientation, plenty of empty breathing room in the
lower third of the frame.
```
+ 風格錨點

### 3. `victory_medallion.png` — 勝利徽章
**尺寸**:方形 800×800,**透明背景**(去背 PNG)。
**用途**:疊在背景中央的獎章圖示,旁邊由網頁自己排版加「勝利」文字,徽章本身不要有任何文字。
**Prompt**:
```
An ornate circular wax-seal-style medallion, ornamental sunburst and laurel
motif radiating outward, polished gold metal with warm highlights, a
faceted star gem at the very center, centered composition, isolated on a
plain transparent background, no text engraved on it.
```
+ 風格錨點

### 4. `defeat_medallion.png` — 失敗徽章
**尺寸**:方形 800×800,**透明背景**。
**用途**:同上,失敗版。
**Prompt**:
```
An ornate circular medallion matching the victory one in shape and
craftsmanship, but tarnished dark silver metal with a crack running across
it, a dim crescent moon motif at the center instead of a star, centered
composition, isolated on a plain transparent background, no text engraved
on it.
```
+ 風格錨點

### 5. `star_particle.png` — 光點粒子
**尺寸**:方形 256×256,**透明背景**。
**用途**:網頁用 CSS/JS 複製多份做「灑落光點」的漂浮/上升粒子動畫,勝敗兩種畫面共用,
不用分開做兩張(顏色由 CSS `filter`/`opacity` 動態調整就好)。
**Prompt**:
```
A single soft glowing six-pointed star or light sparkle, warm white-gold
core fading into a soft outward glow, isolated on a plain transparent
background, no other elements.
```
+ 風格錨點

---

## 备注
- 醒目主體盡量放在畫面中上段,下方 1/3 留空 —— 網頁會在下方疊玩家名字、按鈕(再戰一次/返回大廳)。
- 不需要另外做「平手」版本,目前規則下對戰一定會有明確贏家。
- 如果 AI 生出來的背景左右留白不夠、程式端會用 `background-size: cover` 裁切置中,構圖主體盡量偏置中央即可,不用精算像素。
