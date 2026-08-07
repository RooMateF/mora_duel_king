# 硬幣 + 戰鬥特效 — 美術需求清單

> 交給繪圖 AI 用的規格書,格式跟 `ENDSCREEN_ART_BRIEF.md` 一樣。生成完存進
> `card_game_png/effects_assets/`(本機暫存資料夾,自己新建,不進 git),檔名照下面表格取,
> 我會負責去背/裁切/壓縮/整合進 `web/img/`。

## 共用風格錨點(每個 prompt 最後都加這段)

```
digital painting, semi-realistic fantasy illustration, dramatic rim lighting,
rich saturated color, painterly brushwork, cinematic lighting, no text, no
watermark, no logo, no border, no UI elements, isolated on a plain
transparent background
```

---

## A. 開場硬幣(先後攻擲硬幣)

現況:`web/style.css` 的硬幣兩面只是純 CSS 畫的金色圓形漸層 + 玩家名字文字,太素了。
新設計維持「金色古樸徽章硬幣」的路線,呼應卡牌邊框跟結算畫面徽章的金屬雕花質感,
兩面用太陽/月亮圖騰區分(不代表輸贏,純粹是硬幣的兩面花紋不同)。

**重要**:玩家名字是動態文字,不能烤進圖裡。構圖要把裝飾集中在**上半部跟外圈**,
**下半部/中央留一塊乾淨的區域**(淺色或深色平面都可以,不要有複雜圖案穿過去),
之後我會在那塊區域疊 CSS 文字顯示玩家名字。

### 1. `coin_face_sun.png` — 硬幣正面
**尺寸**:方形 900×900,透明背景。
**Prompt**:
```
An ornate gold coin, embossed metal rim with fine engraved filigree, a
radiant sunburst medallion emblem in the upper portion, polished antique
gold with warm highlights, the lower half of the coin face left as a
smooth, minimally decorated flat gold plaque with just a thin engraved
border line, centered composition, coin face viewed straight-on.
```
+ 風格錨點

### 2. `coin_face_moon.png` — 硬幣反面
**尺寸**:方形 900×900,透明背景。
**Prompt**:
```
An ornate gold coin matching the same rim, filigree, and metal craftsmanship
as a matching sun-emblem coin, but with a crescent moon and small star
emblem in the upper portion instead, the lower half of the coin face left
as a smooth, minimally decorated flat gold plaque with just a thin engraved
border line, centered composition, coin face viewed straight-on.
```
+ 風格錨點

---

## B. 戰鬥碰撞特效

現況:星星對撞只有 CSS 畫的擴散圓環(`spawnShockwave`),沒有真的「打擊」美術。
這批圖是疊在碰撞瞬間的浮動特效圖(跟結算畫面粒子、進化變身特效一樣,用算好座標的
浮動 img 疊上去,不影響版面),依碰撞的星星型別播放對應的圖,增加「這是石頭 vs 剪刀」
之類的具體打擊感,而不是每次都同一圈光。

### 3. `impact_flash.png` — 通用衝擊閃光
**尺寸**:方形 700×700,透明背景。
**用途**:所有碰撞都會用到的基礎閃光,疊在型別專屬特效下面當底。
**Prompt**:
```
A bright radial impact flash burst, intense white-hot core fading into warm
gold rays radiating outward, a few sharp thin light streaks shooting out
further than the main burst, no smoke, no debris, pure light burst.
```
+ 風格錨點

### 4. `impact_rock.png` — 石頭碰撞
**尺寸**:方形 700×700,透明背景。
**用途**:石頭參與的碰撞疊加圖。
**Prompt**:
```
A burst of shattering stone: small angular rock fragments and grey dust
flying outward from a central impact point, a few sparks where stone hits
stone, radiating outward composition, dynamic motion.
```
+ 風格錨點

### 5. `impact_scissor.png` — 剪刀碰撞
**尺寸**:方形 700×700,透明背景。
**用途**:剪刀參與的碰撞疊加圖。
**Prompt**:
```
A sharp diagonal slash effect: two or three crossing blade-slash streaks of
bright metallic light, small sparks scattering along the slash lines,
radiating outward composition, dynamic motion, reads as a fast cutting
strike.
```
+ 風格錨點

### 6. `impact_cloth.png` — 布碰撞
**尺寸**:方形 700×700,透明背景。
**用途**:布參與的碰撞疊加圖。
**Prompt**:
```
A soft puff of impact: a cloud of fine cream-white fabric fibers and dust
puffing outward from a central point, a few loose wavy fabric wisps
trailing off, softer and rounder than a hard impact, radiating outward
composition.
```
+ 風格錨點

---

## 備註
- 三張型別碰撞圖(石頭/剪刀/布)疊在 `impact_flash.png` 上面播,兩張都用同樣的中心點對齊,
  程式端會用 CSS 疊圖,不用自己合成成一張。
- 尺寸都是抓「大概」,構圖主體置中、四周留一點透明邊界即可,程式端會自動置中縮放。
- 這批圖跟 `ENDSCREEN_ART_BRIEF.md` 那批一樣,是分開的追加需求,不用重做卡牌/戰場/大廳
  已經完成的美術。
