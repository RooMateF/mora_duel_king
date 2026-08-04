# 外部(AI 生成)卡圖工作流程

`cardgen.py` 現在支援用外部圖檔取代程式內建的插畫。流程:

1. 用任何 AI 圖像工具(ChatGPT/Midjourney/其他)生成插畫。
2. 存成這個資料夾(`tools/cardgen_source_art/`)裡,檔名跟卡片名稱完全一樣,副檔名 `.png`/`.jpg`/`.jpeg`/`.webp` 都可以(例如 `石頭.png`、`殞石頭.jpg`)。
3. 不用擔心尺寸/比例對不對 —— 程式會自動「填滿裁切」置中塞進卡圖框,長邊會被裁掉一點,構圖盡量把主體放中間、四周留一點餘裕。
4. 可以一張一張慢慢補:哪張卡有圖檔就用外部圖,還沒生成的卡會自動沿用程式內建的插畫頂著,不會等全部湊齊才能重新產卡。
5. 生成/更新完圖檔後執行:
   ```
   python cardgen.py --external
   ```
   會在 `tools/cardgen_out/` 產出完整一套卡(套用外部插畫 + 既有的金屬邊框/名條/圓標/效果文字框)。

金屬邊框、名條、屬性圓標、效果文字框、卡背都**不需要重做**,那套已經調過三輪、風格穩定,只有插畫本體換成外部生成的圖。

---

## 統一風格錨點(每張卡的 prompt 最後都貼這段,確保 11 張圖是同一套風格)

```
digital painting, semi-realistic fantasy illustration, dramatic rim lighting,
rich saturated color, painterly brushwork, centered composition with breathing
room around the subject, plain or softly blurred background unless a scene is
specified, no text, no watermark, no border, no card frame, square-ish
portrait aspect ratio
```

---

## 每張卡的 prompt

### 星星卡(基礎猜拳,3 張)

**石頭 (Rock)**
```
A plain ordinary rock, matte natural stone surface, no unnatural shine or
gloss, subtle cracks and mineral texture, warm earthy brown-grey tones,
simple ground shadow beneath it.
```
+ 風格錨點

**布 (Cloth)**
```
A soft draped piece of cloth, gently flowing and wrinkled fabric with visible
softness, hanging naturally with wavy folds, warm cream/off-white color,
clearly soft and lightweight — should read as clearly SOFTER and more
flexible than a metal-like fabric.
```
+ 風格錨點

**剪刀 (Scissors)**
```
A pair of realistic scissors, sharp polished steel blades, posed dynamically
at a dramatic diagonal angle, blades open wide as if about to cut through
anything — a bold, confident, almost menacing "ready to cut the whole world"
pose. Realistic metal shading, sharp highlights on the cutting edge.
```
+ 風格錨點

### 太陽卡(進化,3 張 + 1 張特效卡)

**殞石頭 (Meteor Rock)**
```
A rock-like meteor hurtling through outer space toward the viewer, glowing
red-hot from atmospheric entry friction, a long streaking fire trail behind
it, dark starry space background, dramatic orange-red glow on the leading
edge.
```
+ 風格錨點

**雷射剪刀 (Laser Scissors)**
```
The same dramatic scissors as above (sharp realistic steel, dynamic diagonal
open-blade pose), but the cutting edge is now charged with glowing blue laser
energy, an electric blue glow along the blade's cutting line, small energy
particles/sparks near the tip.
```
+ 風格錨點

**鈦合金布 (Titanium Cloth)**
```
A piece of cloth that is simultaneously soft-draping AND made of titanium —
show the same soft flowing folds as regular cloth, but with a metallic
silver-blue sheen, and a few sharp hard-edged angular facets/corners poking
through the fabric to show it is rigid metal, not ordinary fabric.
```
+ 風格錨點

**烈陽 (Blazing Sun)**
```
A wide scene: a very bright, intense sun high in the sky, blazing sunbeams,
underneath it a parched cracked earth / dry desert ground with visible
drought cracks, heat haze near the horizon. Warm orange and gold color
palette, dramatic and scorching mood.
```
+ 風格錨點

### 月亮卡(反制/偷變,3 張 + 1 張特效卡)

**偷變石頭 (Steal→Rock)**
```
A surprise jack-in-the-box with its lid popped open, a coiled spring bursting
out of it, and a boxing-glove-like fist launching out on top of the spring —
a sudden, surprising "pop!" moment. Playful but bold, dynamic motion lines
around the fist.
```
+ 風格錨點

**偷變剪刀 (Steal→Scissors)**
```
A single stylish magician's hand (wearing a cuffed glove/sleeve edge, NOT a
full body or face) conjuring a pair of scissors into existence, small magic
sparkle particles around the hand and the scissors, mysterious purple ambient
glow.
```
+ 風格錨點

**偷變布 (Steal→Cloth)**
```
A single stylish magician's hand (wearing a cuffed glove/sleeve edge, NOT a
full body or face) pulling a piece of soft cloth out from a puff of smoke,
wisps of smoke curling around the hand, mysterious purple ambient glow.
```
+ 風格錨點

**日蝕 (Eclipse)**
```
The same wide scene as the Blazing Sun card (bright sun high in the sky over
a cracked dry earth), but now dimmed into a dramatic dusky orange-red twilight
— and a bold, imposing manga-style wolf head in profile is biting into the
edge of the sun, fangs bared, narrowed eye glinting, silhouetted with warm
rim-light from the sun behind it. Reference: the East Asian folklore of
"Tiangou eating the sun" (天狗食日), but drawn as a fierce dominant wolf, not
a dog.
```
+ 風格錨點

---

## 建議尺寸

輸出圖片建議接近 **3:4 直式或方形**(程式的卡圖框比例約 684:722,幾乎是 1:1.06),太寬或太窄都沒關係,程式會自動裁,但主體盡量放中間、四周留一點空間,避免裁切裁到重要細節。
