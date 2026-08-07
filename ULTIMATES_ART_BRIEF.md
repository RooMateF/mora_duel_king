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

## A. 烈陽 / 日蝕 全螢幕必殺特效

現況:這兩張是太陽卡/月亮卡裡唯一的「強化特效卡」跟「反制特效卡」(規則書上特別標註),
但發動時畫面上只有跟其他卡一樣的一圈衝擊波,份量跟「普通卡」沒兩樣,對不起它們在規則上
的特殊地位。這兩張圖是發動瞬間**疊在整個戰場上方**的全螢幕光效(不是卡格大小的小圖),
構圖直接呼應這兩張卡本身的插畫(炙陽/日蝕吞日)。

**尺寸**:兩張都是直式 1080×1920,**這次不用去背**、就是滿版背景圖(疊上去時用淡入淡出
控制透明度,不需要裁切成不規則形狀)。

### 1. `ultimate_sun_flare.png` — 烈陽發動
**Prompt**:
```
A blinding wide-angle view of a scorching sun overhead, intense golden-white
flare washing across the whole frame, sweeping rays of light, drifting
embers and heat haze, warm orange-gold color grading across the entire
image, dramatic and overwhelming scale, portrait orientation.
```
+ 風格錨點

### 2. `ultimate_eclipse_flare.png` — 日蝕發動
**Prompt**:
```
A blinding wide-angle view matching the same scorching-sun composition, but
now the sun is dimmed into a dusky orange-red eclipse, a bold dark wolf
silhouette biting into its edge, cold shadow sweeping across the frame from
one side, dramatic desaturated color grading except for the warm eclipse rim
light, portrait orientation.
```
+ 風格錨點

---

## B. 偷變系列(月亮卡)施法特效

現況:偷變石頭/偷變剪刀/偷變布這三張發動時,跟其他月亮卡一樣只是「翻牌 + 冷藍光」,
沒有呼應卡面本身「驚喜彈出」「魔法手變出東西」的畫面感。這張圖疊在月亮卡格上,
營造「施法瞬間」的神秘感。

### 3. `steal_conjure_puff.png` — 偷變施法煙霧
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

## C. 通用:飛行殘影

現況:卡牌飛入手牌/戰場的動畫(抽牌、對手出牌)目前是乾淨俐落地飛,沒有殘影拖尾,
速度感偏弱。這張圖疊在飛行中的卡牌後方,增加「咻」的速度感。

### 4. `speed_streak.png` — 速度殘影
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
- A 類(烈陽/日蝕)兩張建議優先,因為這兩張卡在規則書上本來就被標成特殊卡,視覺上長期沒對應到。
