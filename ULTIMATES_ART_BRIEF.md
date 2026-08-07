# 必殺技 + 偷變特效 — 美術需求清單(第三批)

> 格式跟前兩批(`ENDSCREEN_ART_BRIEF.md`、`EFFECTS_ART_BRIEF.md`)一樣。生成完存進
> `card_game_png/ultimates_assets/`(本機暫存,自己新建,不進 git),我負責去背/裁切/整合。

## 共用風格錨點(每個 prompt 最後都加這段)

```
digital painting, semi-realistic fantasy illustration, dramatic rim lighting,
rich saturated color, painterly brushwork, cinematic lighting, no text, no
watermark, no logo, no border, no UI elements, isolated on a plain
transparent background
```

---

## A. 烈陽發動 — 全螢幕必殺特效

現況:烈陽是太陽卡裡唯一的「強化特效卡」(規則書上特別標註),但發動時畫面上只有
跟其他卡一樣的一圈衝擊波,份量跟「普通卡」沒兩樣。這張圖是發動瞬間**疊在整個戰場
上方**的全螢幕光效(不是卡格大小的小圖),構圖直接呼應烈陽卡本身的插畫。

**尺寸**:直式 1080×1920,**這次不用去背**、就是滿版背景圖(疊上去時用淡入淡出控制
透明度,不需要裁切成不規則形狀)。

### 1. `ultimate_sun_flare.png` — 烈陽發動:陽光閃光
**Prompt**:
```
A blinding wide-angle view of a scorching sun overhead, intense golden-white
flare washing across the whole frame, sweeping rays of light, drifting
embers and heat haze, warm orange-gold color grading across the entire
image, dramatic and overwhelming scale, portrait orientation.
```
+ 風格錨點

### 2. `ultimate_sun_groundcrack.png` — 烈陽發動:大地龜裂
使用者想在陽光閃光之外,額外加一層「地面被烈日曬到龜裂開來」的效果,疊在畫面下半部
(戰場面板附近),用擴散/成長動畫呈現裂痕從中心蔓延開來的過程,比單純一片閃光更有
「大地正在被灼燒」的實感。

**尺寸**:橫式 1200×900,**透明背景**,裂痕主體集中在畫面中下段、四周留白淡出,
方便疊在戰場下方且不會有明顯方形邊界。
**Prompt**:
```
A close-up of parched dry earth cracking open under intense heat, deep
jagged fissures radiating outward from a bright center, glowing
orange-gold light seeping up through the cracks as if magma or sunlight is
underneath, dust and small debris crumbling at the crack edges, dramatic
top-down or slightly angled view, isolated ground texture with soft fading
edges.
```
+ 風格錨點

---

## B. 日蝕反制成功 — 三格分鏡過場(取代原本單張構想)

使用者具體描述了想要的畫面:「亮著紅眼的狼從正面一口將太陽咬碎並吞下」。這個畫面感比
單張全螢幕光效更有戲,適合做成**三張連續分鏡**,像格鬥遊戲必殺技過場那樣快速切換
(每張顯示 0.5-0.7 秒,硬切/極快淡入,不是慢慢淡出淡入),中間第 2 張(咬穿瞬間)
搭配畫面震動 + 白色閃光(閃光直接沿用 `EFFECTS_ART_BRIEF.md` 那批的 `impact_flash.png`,
不用重畫)。整段大概 1.8-2 秒,播完接回現有的日蝕反制衝擊波。狼眼發光的呼吸感、震動、
閃光時機都是程式端處理,**這三張靜態分鏡圖就是全部需要生成的東西**,不需要動畫或影片。

**尺寸**:三張都是直式 1080×1920,**不用去背**,滿版構圖,同一隻狼、同一顆太陽,
確保三張之間的角度/位置/光線調性連貫(建議生成時把前一張當參考圖再生下一張,
或至少在 prompt 裡明確描述同一隻狼、同一個視角)。

### 3. `eclipse_wolf_lunge.png` — 分鏡①:撲咬前
**Prompt**:
```
A fierce wolf emerging from deep shadow, glowing bright red eyes, fangs
bared, caught mid-lunge toward the viewer, a bright sun still blazing behind
it, dramatic backlighting silhouetting the wolf's form against the sun,
tension and imminent danger, portrait orientation, full-bleed composition.
```
+ 風格錨點

### 4. `eclipse_wolf_bite.png` — 分鏡②:咬穿瞬間(重頭戲)
**Prompt**:
```
An extreme close-up of a wolf's jaws clamped directly onto a blazing sun
head-on, cracks of blinding white-gold light bursting out between its
fangs, the wolf's eyes glowing intensely red at their brightest, dust and
light fragments exploding outward from the bite point, maximum intensity
and impact, portrait orientation, full-bleed composition.
```
+ 風格錨點

### 5. `eclipse_wolf_aftermath.png` — 分鏡③:吞噬之後
**Prompt**:
```
The sun now crushed into a dim, cracked, dark orange-red crescent eclipse,
embers and fragments of light drifting downward and fading, the wolf's
silhouette receding back into darkness at the edge of frame, its red eyes
dimming, quiet and cold aftermath, portrait orientation, full-bleed
composition.
```
+ 風格錨點

---

## C. 偷變系列(月亮卡)施法特效

現況:偷變石頭/偷變剪刀/偷變布這三張發動時,跟其他月亮卡一樣只是「翻牌 + 冷藍光」,
沒有呼應卡面本身「驚喜彈出」「魔法手變出東西」的畫面感。這張圖疊在月亮卡格上,
營造「施法瞬間」的神秘感。

### 6. `steal_conjure_puff.png` — 偷變施法煙霧
**尺寸**:方形 700×700,**透明背景**。
**用途**:三張偷變卡共用,疊在月亮卡格中心。
**Prompt**:
```
A swirling puff of mystical purple smoke with small magic sparkle particles
scattered through it, wisps curling outward from a central point, an
ambient purple glow, playful but mysterious, radiating outward composition.
```
+ 風格錨點

---

## D. 通用:飛行殘影

現況:卡牌飛入手牌/戰場的動畫(抽牌、對手出牌)目前是乾淨俐落地飛,沒有殘影拖尾,
速度感偏弱。這張圖疊在飛行中的卡牌後方,增加「咻」的速度感。

### 7. `speed_streak.png` — 速度殘影
**尺寸**:橫式 900×400,**透明背景**,主體(拖尾)朝右,尾端漸淡。
**用途**:疊在快速移動的卡牌/牌堆圖片後方,跟著飛行方向旋轉貼上去。
**Prompt**:
```
A dynamic motion-blur speed streak, several curved light trail lines
sweeping from left to right, brightest and sharpest on the right end,
fading into nothing on the left end, warm white-gold color, energetic and
fast, horizontal composition.
```
+ 風格錨點

---

## 備註
- 這批圖是「錦上添花」的第三輪追加,不影響核心玩法,做不做、先做哪個都可以視時間彈性調整。
- A、B 類(烈陽/日蝕,共 5 張)建議優先,因為這兩張卡在規則書上本來就被標成特殊卡,
  視覺上長期沒對應到,而且日蝕那組分鏡使用者已經有明確畫面構想。
- 日蝕三格分鏡生成時盡量保持狼跟太陽的角度、大小、光線一致,三張才會像同一個鏡頭
  切換,不是三張不相干的插畫。
