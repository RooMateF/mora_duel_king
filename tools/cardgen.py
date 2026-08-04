# -*- coding: utf-8 -*-
"""
猜☆拳☆王 卡牌美術產生器(遊戲王印刷卡風格)
用 Pillow 畫出金屬邊框、漸層名條、屬性圓標、內凹卡圖框、效果文字框的完整卡牌,
輸出高解析度 PNG,取代原本用 SVG 幾何圖形手刻的手繪風。
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 800, 1120
OUT_DIR = os.path.join(os.path.dirname(__file__), "cardgen_out")
os.makedirs(OUT_DIR, exist_ok=True)

# 標楷體/細明體/正黑體都太像正式文件的字體,遊戲感不足。系統裡沒有現成的可愛/漫畫中文字型,
# 改用 Yu Gothic(日系黑體,圓潤一點、跟正黑體的方正筆畫不同)當基底,卡名再疊描邊+陰影做成
# 「遊戲 Logo」式的處理,靠風格化處理彌補字型本身選擇有限的問題
FONT_BOLD = "C:/Windows/Fonts/YuGothB.ttc"   # 種類列/卡名用粗體
FONT_REG = "C:/Windows/Fonts/YuGothM.ttc"    # 效果文字用中黑,比全粗體易讀
FONT_TITLE = "C:/Windows/Fonts/YuGothB.ttc"
FONT_BODY = "C:/Windows/Fonts/YuGothM.ttc"


def font(path, size):
    return ImageFont.truetype(path, size)


# ---------------------------------------------------------------- 色彩主題 --

THEMES = {
    "star": {
        "frame_light": (154, 190, 224),
        "frame_mid": (58, 104, 156),
        "frame_dark": (22, 44, 74),
        "name_text": (18, 28, 40),
        "badge": (74, 128, 184),
        "kind_label": "星星卡",
    },
    "sun": {
        "frame_light": (255, 200, 130),
        "frame_mid": (196, 108, 32),
        "frame_dark": (100, 48, 10),
        "name_text": (40, 20, 4),
        "badge": (214, 122, 40),
        "kind_label": "太陽卡",
    },
    "moon": {
        "frame_light": (206, 168, 232),
        "frame_mid": (110, 60, 160),
        "frame_dark": (48, 20, 78),
        "name_text": (28, 12, 42),
        "badge": (128, 72, 176),
        "kind_label": "月亮卡",
    },
}

PAPER = (245, 238, 220)
INK = (24, 20, 16)


# --------------------------------------------------------------- 小工具群 --

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top_color, bottom_color):
    w, h = size
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        grad.putpixel((0, y), lerp(top_color, bottom_color, t))
    return grad.resize((w, h))


def diagonal_bevel_gradient(size, light, mid, dark):
    """左上亮、中段主色、右下暗,做出金屬浮雕邊框的立體感。"""
    w, h = size
    grad = Image.new("RGB", size)
    px = grad.load()
    diag = w + h
    for y in range(h):
        for x in range(w):
            t = (x + y) / diag
            if t < 0.45:
                c = lerp(light, mid, t / 0.45)
            else:
                c = lerp(mid, dark, (t - 0.45) / 0.55)
            px[x, y] = c
    return grad


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def noise_texture_rgb(size, seed=0, lo=225, hi=255, blur=0.6):
    """灰階顆粒雜訊(轉成 RGB 給 multiply 用),打散乾淨漸層的色帶、做出霧面材質的顆粒感,
    不是拋光的塑膠感漸層。"""
    rnd = random.Random(seed)
    tex = Image.new("L", size)
    px = tex.load()
    for y in range(size[1]):
        for x in range(size[0]):
            px[x, y] = rnd.randint(lo, hi)
    if blur:
        tex = tex.filter(ImageFilter.GaussianBlur(blur))
    return tex.convert("RGB")


def brushed_streaks_rgba(size, seed, angle_deg=100, count=140, color=(255, 255, 255), alpha=14):
    """一堆細細的短直線,方向一致、疊起來像拉絲金屬的紋理,取代大片乾淨的高光。"""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rnd = random.Random(seed)
    w, h = size
    rad = math.radians(angle_deg)
    dx, dy = math.cos(rad), math.sin(rad)
    diag = math.hypot(w, h)
    for _ in range(count):
        cx = rnd.uniform(0, w)
        cy = rnd.uniform(0, h)
        length = rnd.uniform(diag * 0.05, diag * 0.22)
        x1, y1 = cx - dx * length / 2, cy - dy * length / 2
        x2, y2 = cx + dx * length / 2, cy + dy * length / 2
        a = max(0, rnd.randint(alpha - 8, alpha + 8))
        d.line([(x1, y1), (x2, y2)], fill=color + (a,), width=1)
    return layer.filter(ImageFilter.GaussianBlur(0.4))


def paper_texture(size, seed=0):
    """簡單的紙紋:很多細小的隨機短線疊加雜訊,不需要 numpy。"""
    rnd = random.Random(seed)
    tex = Image.new("L", size, 255)
    d = ImageDraw.Draw(tex)
    for _ in range(size[0] * size[1] // 180):
        x = rnd.randint(0, size[0] - 1)
        y = rnd.randint(0, size[1] - 1)
        v = rnd.randint(215, 250)
        d.point((x, y), fill=v)
        if rnd.randint(0, 1):
            d.point((x + 1, y), fill=v)
    return tex.filter(ImageFilter.GaussianBlur(0.4))


def draw_title_text(draw, xy, text, fnt, fill, outline, outline_width=3, shadow_offset=3):
    """卡名用「遊戲 Logo」式描边+陰影處理:陰影墊底、描邊圈一圈、再疊上淺色主體,
    靠風格化處理讓文字讀起來像遊戲標題而不是公文,彌補系統字型選擇有限的問題。"""
    x, y = xy
    draw.text((x + shadow_offset, y + shadow_offset), text, font=fnt, fill=(10, 8, 6))
    for dx in range(-outline_width, outline_width + 1):
        for dy in range(-outline_width, outline_width + 1):
            if dx * dx + dy * dy <= outline_width * outline_width:
                draw.text((x + dx, y + dy), text, font=fnt, fill=outline)
    draw.text((x, y), text, font=fnt, fill=fill)


def draw_wrapped_text(draw, xy, text, fnt, fill, max_width, line_spacing=1.32, indent=0):
    """手動換行(中文逐字量寬),支援 \\n 保留段落,並讓每個「①②」之後的內容用 indent 對齊。"""
    x0, y0 = xy
    y = y0
    for para in text.split("\n"):
        cur = ""
        cur_indent = 0
        started = False
        for ch in para:
            trial = cur + ch
            w = draw.textlength(trial, font=fnt)
            if w > max_width - cur_indent and cur:
                draw.text((x0 + cur_indent, y), cur, font=fnt, fill=fill)
                y += int(fnt.size * line_spacing)
                cur = ch
            else:
                cur = trial
            if not started and ch in "①②③":
                cur_indent = indent
                started = True
        if cur:
            draw.text((x0 + cur_indent, y), cur, font=fnt, fill=fill)
            y += int(fnt.size * line_spacing)
    return y


_MEASURE_DRAW = ImageDraw.Draw(Image.new("L", (1, 1)))


def wrapped_text_height(text, fnt, max_width, line_spacing=1.32, indent=0):
    """跟 draw_wrapped_text 同一套換行邏輯,但只算會佔幾行、不用真的畫,拿來試字級大小用。"""
    lines = 0
    for para in text.split("\n"):
        cur = ""
        cur_indent = 0
        started = False
        for ch in para:
            trial = cur + ch
            w = _MEASURE_DRAW.textlength(trial, font=fnt)
            if w > max_width - cur_indent and cur:
                lines += 1
                cur = ch
            else:
                cur = trial
            if not started and ch in "①②③":
                cur_indent = indent
                started = True
        lines += 1
    return int(lines * fnt.size * line_spacing)


def fit_effect_font(text, max_width, max_height, indent=0, sizes=(25, 23, 21, 19, 17)):
    """由大到小試字級,挑第一個排版高度塞得下文字框的。"""
    for sz in sizes:
        fnt = font(FONT_BODY, sz)
        if wrapped_text_height(text, fnt, max_width, indent=indent) <= max_height:
            return fnt
    return font(FONT_REG, sizes[-1])


# ------------------------------------------------------------- 光影工具 --

def directional_gradient(size, light, dark, angle_deg=135, small=48):
    """低解析度算好再放大,給任意形狀當「單一光源」的方向性漸層底色。"""
    rad = math.radians(angle_deg)
    dx, dy = math.cos(rad), math.sin(rad)
    grad = Image.new("RGB", (small, small))
    px = grad.load()
    corners = [(0, 0), (small, 0), (0, small), (small, small)]
    projs = [cx * dx + cy * dy for cx, cy in corners]
    lo, hi = min(projs), max(projs)
    span = max(1e-6, hi - lo)
    for y in range(small):
        for x in range(small):
            t = ((x * dx + y * dy) - lo) / span
            px[x, y] = lerp(light, dark, t)
    return grad.resize(size, Image.BICUBIC)


def add_grain(rgba_layer, seed, lo=222, hi=255, blur=0.5):
    """把雜訊用 multiply 疊到 RGBA 圖層的顏色上、保留原本的 alpha 形狀,
    讓平滑的方向性漸層讀起來像有實際材質顆粒(石頭斑點、紙纖維、拉絲金屬),不是塑膠感的純色漸層。"""
    rgb = rgba_layer.convert("RGB")
    grain = noise_texture_rgb(rgba_layer.size, seed=seed, lo=lo, hi=hi, blur=blur)
    shaded = ImageChops.multiply(rgb, grain)
    out = shaded.convert("RGBA")
    out.putalpha(rgba_layer.split()[3])
    return out


def radial_glow_rgba(size, color, cx_t=0.5, cy_t=0.5, radius_t=0.5, feather=1.0, small=80):
    """中心亮、往外淡出的光暈,回傳 RGBA。radius_t 是半徑佔 max(size) 的比例。低解析度算完再放大。"""
    w, h = size
    sw = max(8, int(small * w / max(w, h)))
    sh = max(8, int(small * h / max(w, h)))
    field = Image.new("L", (sw, sh))
    px = field.load()
    cx, cy = sw * cx_t, sh * cy_t
    r = max(sw, sh) * radius_t
    for y in range(sh):
        for x in range(sw):
            d = math.hypot(x - cx, y - cy) / max(1e-6, r)
            px[x, y] = max(0, 255 - int(255 * (d ** feather)))
    field = field.resize(size, Image.BICUBIC)
    solid = Image.new("RGBA", size, color)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(solid, (0, 0), field)
    return out


# ------------------------------------------------------------- 卡牌骨架 --

def _badge_glyph(card, cx, cy, r, theme_key):
    """屬性圓標中央的白色小圖示(星/日/月),跟卡背的 emblem 用同一套形狀語彙但改成單色好在色底上看清楚。
    月標的弦月缺角用獨立 RGBA 圖層的 alpha 遮罩挖空,不能直接在 draw 上疊色(圓標底色是漸層,疊實色會很醜)。"""
    glyph_col = (255, 255, 255)
    if theme_key == "star":
        draw = ImageDraw.Draw(card)
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.42
            pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
        draw.polygon(pts, fill=glyph_col)
        return card
    elif theme_key == "sun":
        draw = ImageDraw.Draw(card)
        draw.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], fill=glyph_col)
        for i in range(8):
            ang = (math.pi / 4) * i
            x1, y1 = cx + math.cos(ang) * r * 0.62, cy + math.sin(ang) * r * 0.62
            x2, y2 = cx + math.cos(ang) * r * 1.0, cy + math.sin(ang) * r * 1.0
            draw.line([(x1, y1), (x2, y2)], fill=glyph_col, width=5)
        return card
    elif theme_key == "moon":
        rr = int(r * 0.68)
        size = rr * 2 + 4
        moon_alpha = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(moon_alpha)
        md.ellipse([2, 2, size - 2, size - 2], fill=255)
        md.ellipse([2 + int(rr * 0.5), 2, size - 2 + int(rr * 0.5), size - 2], fill=0)
        moon_rgba = Image.new("RGBA", (size, size), glyph_col + (0,))
        moon_rgba.putalpha(moon_alpha)
        card = card.convert("RGBA")
        card.alpha_composite(moon_rgba, (int(cx - size / 2), int(cy - size / 2)))
        return card.convert("RGB")
    return card


def build_frame(theme_key, name, kind_line, effect_text):
    th = THEMES[theme_key]
    card = Image.new("RGB", (W, H), (10, 10, 12))

    # 1) 金屬浮雕外框(左上亮、右下暗的斜向漸層,做出立體邊框感)。
    # 疊一層雜訊顆粒(乘法)打散乾淨色帶,再疊幾道拉絲紋理,讓它讀起來是「霧面壓花金屬」
    # 而不是拋光塑膠 —— 這是「質感」訴求的核心修正。
    bevel = diagonal_bevel_gradient((W, H), th["frame_light"], th["frame_mid"], th["frame_dark"])
    grain = noise_texture_rgb((W, H), seed=hash(theme_key) % 5000, lo=222, hi=255, blur=0.5)
    bevel = ImageChops.multiply(bevel, grain)
    brushed = brushed_streaks_rgba((W, H), seed=(hash(theme_key) + 1) % 5000, angle_deg=125,
                                    count=260, color=(255, 255, 255), alpha=10)
    bevel = Image.alpha_composite(bevel.convert("RGBA"), brushed).convert("RGB")
    outer_mask = rounded_mask((W, H), 34)
    card.paste(bevel, (0, 0), outer_mask)

    draw = ImageDraw.Draw(card)
    hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(hi).rounded_rectangle([2, 2, W - 3, H - 3], radius=34,
                                          outline=lerp(th["frame_light"], (255, 255, 255), 0.5) + (55,), width=2)
    card = Image.alpha_composite(card.convert("RGBA"), hi).convert("RGB")
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=34, outline=(0, 0, 0), width=6)

    pad = 34
    inner = [pad, pad, W - pad, H - pad]
    draw.rounded_rectangle(inner, radius=18, fill=(24, 22, 26))

    # 2) 名條(拉絲金屬牌感,不用大片高光,改用淡淡的雜訊 + 拉絲紋理做「霧面銘牌」)
    name_box = [pad + 10, pad + 10, W - pad - 10, pad + 108]
    nb_w, nb_h = name_box[2] - name_box[0], name_box[3] - name_box[1]
    name_grad = vertical_gradient(
        (nb_w, nb_h), lerp(th["frame_light"], (255, 255, 255), 0.14), th["frame_mid"],
    )
    name_grad = ImageChops.multiply(name_grad, noise_texture_rgb((nb_w, nb_h), seed=hash(name) % 5000,
                                                                   lo=228, hi=255, blur=0.5))
    name_streaks = brushed_streaks_rgba((nb_w, nb_h), seed=hash(name + "n") % 5000, angle_deg=3,
                                         count=90, color=(255, 255, 255), alpha=16)
    name_grad = Image.alpha_composite(name_grad.convert("RGBA"), name_streaks).convert("RGB")
    name_mask = Image.new("L", (nb_w, nb_h), 0)
    ImageDraw.Draw(name_mask).rounded_rectangle([0, 0, nb_w - 1, nb_h - 1], radius=10, fill=255)
    card.paste(name_grad, (name_box[0], name_box[1]), name_mask)
    draw.rounded_rectangle(name_box, radius=10, outline=(20, 16, 10), width=3)
    draw.rounded_rectangle([name_box[0] + 4, name_box[1] + 4, name_box[2] - 4, name_box[3] - 4],
                            radius=7, outline=lerp(th["frame_dark"], (0, 0, 0), 0.4), width=1)

    f_name = font(FONT_TITLE, 50)
    draw_title_text(draw, (name_box[0] + 22, name_box[1] + 23), name, f_name,
                     fill=(255, 250, 240), outline=lerp(th["name_text"], (0, 0, 0), 0.3))

    # 3) 屬性圓標(右上角,疊在名條右緣)—— 改成「刻花徽章」而不是玻璃球:
    # 只用淡淡的內凹陰影跟細刻線做立體感,不用大片高光,再疊噪點做出鑄造金屬的顆粒感
    badge_cx = name_box[2] - 4
    badge_cy = name_box[1] + (name_box[3] - name_box[1]) // 2
    badge_r = 46
    draw.ellipse([badge_cx - badge_r - 6, badge_cy - badge_r - 6, badge_cx + badge_r + 6, badge_cy + badge_r + 6],
                 fill=(20, 16, 10))
    badge_size = (badge_r * 2, badge_r * 2)
    badge_grad = directional_gradient(badge_size, lerp(th["badge"], (255, 255, 255), 0.22),
                                       lerp(th["badge"], (0, 0, 0), 0.35), angle_deg=125)
    badge_grad = ImageChops.multiply(badge_grad, noise_texture_rgb(badge_size, seed=hash(theme_key + "b") % 5000,
                                                                     lo=220, hi=255, blur=0.6))
    badge_mask = Image.new("L", badge_size, 0)
    ImageDraw.Draw(badge_mask).ellipse([0, 0, badge_size[0] - 1, badge_size[1] - 1], fill=255)
    card.paste(badge_grad, (badge_cx - badge_r, badge_cy - badge_r), badge_mask)
    draw = ImageDraw.Draw(card)
    draw.ellipse([badge_cx - badge_r, badge_cy - badge_r, badge_cx + badge_r, badge_cy + badge_r],
                 outline=(20, 16, 10), width=2)
    draw.ellipse([badge_cx - badge_r + 6, badge_cy - badge_r + 6, badge_cx + badge_r - 6, badge_cy + badge_r - 6],
                 outline=lerp(th["badge"], (0, 0, 0), 0.5), width=1)
    card = _badge_glyph(card, badge_cx, badge_cy, badge_r * 0.62, theme_key)
    draw = ImageDraw.Draw(card)

    # 4) 卡圖框(內凹黑邊 + 內陰影)
    art_box = [pad + 24, name_box[3] + 16, W - pad - 24, H - pad - 206]
    art_w, art_h = art_box[2] - art_box[0], art_box[3] - art_box[1]
    art_bg = ImageChops.multiply(Image.new("RGB", (art_w, art_h), (250, 248, 240)),
                                  noise_texture_rgb((art_w, art_h), seed=hash(name + "a") % 5000, lo=238, hi=255, blur=0.5))
    card.paste(art_bg, (art_box[0], art_box[1]))
    draw = ImageDraw.Draw(card)
    edge_alpha = Image.new("L", (art_w, art_h), 0)
    ImageDraw.Draw(edge_alpha).rectangle([0, 0, art_w - 1, art_h - 1], outline=255, width=26)
    edge_alpha = edge_alpha.filter(ImageFilter.GaussianBlur(14)).point(lambda v: int(v * 0.55))
    shadow_rgba = Image.new("RGBA", (art_w, art_h), (0, 0, 0, 0))
    shadow_rgba.putalpha(edge_alpha)
    card = card.convert("RGBA")
    card.alpha_composite(shadow_rgba, (art_box[0], art_box[1]))
    card = card.convert("RGB")
    draw = ImageDraw.Draw(card)
    draw.rectangle(art_box, outline=(20, 16, 10), width=5)

    # 5) 卡片種類列
    kind_box = [pad + 24, art_box[3] + 12, W - pad - 24, art_box[3] + 60]
    draw.rectangle(kind_box, fill=lerp(th["frame_dark"], (0, 0, 0), 0.2))
    draw.rectangle(kind_box, outline=(0, 0, 0), width=2)
    f_kind = font(FONT_BOLD, 28)
    draw.text((kind_box[0] + 14, kind_box[1] + 6), kind_line, font=f_kind, fill=(255, 245, 225))

    # 6) 效果文字框(米黃紙感)
    text_box = [pad + 24, kind_box[3] + 10, W - pad - 24, H - pad - 22]
    tex = paper_texture((text_box[2] - text_box[0], text_box[3] - text_box[1]), seed=hash(name) % 1000)
    paper_img = Image.new("RGB", tex.size, PAPER)
    paper_img = ImageChops.multiply(paper_img, tex.convert("RGB"))
    card.paste(paper_img, (text_box[0], text_box[1]))
    draw = ImageDraw.Draw(card)
    draw.rectangle(text_box, outline=(20, 16, 10), width=3)

    eff_max_w = text_box[2] - text_box[0] - 28
    eff_max_h = text_box[3] - text_box[1] - 24
    f_eff = fit_effect_font(effect_text, eff_max_w, eff_max_h, indent=30)
    draw_wrapped_text(draw, (text_box[0] + 14, text_box[1] + 12), effect_text, f_eff, INK,
                       eff_max_w, indent=30)

    return card, art_box


# ------------------------------------------------------------- 插畫主體 --

def illus_rock(art_size):
    w, h = art_size
    cx, cy = w * 0.5, h * 0.56
    s = min(w, h) * 0.34
    pts_unit = [
        (-0.9, -0.15), (-0.55, -0.62), (0.05, -0.85), (0.55, -0.6),
        (0.92, -0.05), (0.78, 0.5), (0.3, 0.88), (-0.35, 0.82),
        (-0.85, 0.4),
    ]
    pts = [(cx + ux * s, cy + uy * s) for ux, uy in pts_unit]

    layer = Image.new("RGBA", art_size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", art_size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([cx - s * 0.9, cy + s * 0.75, cx + s * 0.95, cy + s * 1.05],
                                    fill=(20, 14, 10, 130))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))

    mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    grad = directional_gradient(art_size, (168, 150, 128), (58, 46, 36), angle_deg=135)
    body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    body.paste(grad, (0, 0), mask)
    body = add_grain(body, seed=1, lo=205, hi=255, blur=0.4)
    layer.alpha_composite(body)

    # 分面陰影:幾撮模糊的明暗斑塊,裁到岩石輪廓內,做出凹凸不平的岩面(不是乾淨的單一漸層)
    rnd = random.Random(3)
    blobs = Image.new("RGBA", art_size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(blobs)
    for _ in range(9):
        bx = cx + rnd.uniform(-s * 0.75, s * 0.75)
        by = cy + rnd.uniform(-s * 0.75, s * 0.75)
        br = rnd.uniform(s * 0.16, s * 0.32)
        dark = rnd.random() < 0.55
        col = (10, 8, 6, rnd.randint(35, 65)) if dark else (255, 250, 235, rnd.randint(25, 50))
        bd.ellipse([bx - br, by - br, bx + br, by + br], fill=col)
    blobs = blobs.filter(ImageFilter.GaussianBlur(10))
    body_mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(body_mask).polygon(pts, fill=255)
    blobs.putalpha(ImageChops.multiply(blobs.split()[3], body_mask))
    layer.alpha_composite(blobs)

    d = ImageDraw.Draw(layer)
    d.line(pts + [pts[0]], fill=(28, 20, 14, 255), width=6, joint="curve")
    cracks = [
        [(cx - s * 0.3, cy - s * 0.3), (cx - s * 0.05, cy + 0.05 * s), (cx - s * 0.25, cy + s * 0.4)],
        [(cx + s * 0.15, cy - s * 0.45), (cx + s * 0.3, cy - s * 0.05)],
    ]
    for line in cracks:
        d.line(line, fill=(35, 26, 18, 230), width=4, joint="curve")
        shifted = [(x + 2, y + 2) for x, y in line]
        d.line(shifted, fill=(210, 190, 160, 140), width=2, joint="curve")
    # 苔痕/礦點斑駁:一撮撮暗色小圓點,打破整塊漸層過於乾淨的觀感
    for _ in range(40):
        px = cx + rnd.uniform(-s, s)
        py = cy + rnd.uniform(-s, s)
        if not _point_in_poly(px, py, pts):
            continue
        rr = rnd.uniform(2, 5)
        tone = rnd.choice([(30, 24, 18, 90), (200, 185, 150, 70)])
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=tone)
    return layer


def illus_meteor(art_size):
    """殞石頭:從宇宙中砸來的隕石,拖著大氣摩擦燒出的橘紅色尾焰,背景是深空星點,
    跟平常擺在米色卡圖底上的石頭完全是不同的場景,而不是同一顆石頭加個發光圈而已。"""
    w, h = art_size
    cx, cy = w * 0.56, h * 0.46
    s = min(w, h) * 0.28

    bg = directional_gradient(art_size, (34, 16, 12), (8, 5, 8), angle_deg=205)
    bg = ImageChops.multiply(bg, noise_texture_rgb(art_size, seed=71, lo=238, hi=255, blur=0.4))
    layer = bg.convert("RGBA")
    rnd = random.Random(71)
    for _ in range(28):
        sx = rnd.randint(0, w - 1)
        sy = rnd.randint(0, h - 1)
        if math.hypot(sx - cx, sy - cy) < s * 2.0:
            continue
        rr = rnd.choice([1, 1, 2])
        alpha = rnd.randint(140, 220)
        ImageDraw.Draw(layer).ellipse([sx - rr, sy - rr, sx + rr, sy + rr], fill=(255, 235, 210, alpha))

    # 尾焰:往左下拖出一長串橘紅色大氣摩擦火焰,越靠近石頭越亮越集中
    for i in range(8):
        t = i / 7
        tx = cx - 0.62 * s * (0.4 + t * 3.0)
        ty = cy + 0.66 * s * (0.4 + t * 3.0)
        rr = s * (0.66 - t * 0.5)
        col = lerp((255, 235, 170), (190, 35, 10), t)
        glow_layer = radial_glow_rgba(art_size, col + (int(200 * (1 - t * 0.75)),),
                                       cx_t=tx / w, cy_t=ty / h, radius_t=rr / max(w, h), feather=1.25)
        layer.alpha_composite(glow_layer)

    pts_unit = [
        (-0.9, -0.15), (-0.55, -0.62), (0.05, -0.85), (0.55, -0.6),
        (0.92, -0.05), (0.78, 0.5), (0.3, 0.88), (-0.35, 0.82), (-0.85, 0.4),
    ]
    pts = [(cx + ux * s, cy + uy * s) for ux, uy in pts_unit]
    mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    grad = directional_gradient(art_size, (255, 150, 60), (60, 30, 20), angle_deg=50)
    body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    body.paste(grad, (0, 0), mask)
    body = add_grain(body, seed=73, lo=210, hi=255, blur=0.4)
    layer.alpha_composite(body)

    d = ImageDraw.Draw(layer)
    d.line(pts + [pts[0]], fill=(20, 10, 6, 255), width=5, joint="curve")
    # 迎風面(右上)燒得最紅最亮,貼著輪廓補一圈熾熱光暈
    hot_edge = radial_glow_rgba(art_size, (255, 205, 90, 210), cx_t=(cx + s * 0.5) / w,
                                 cy_t=(cy - s * 0.5) / h, radius_t=0.32, feather=1.0)
    layer.alpha_composite(hot_edge)
    return layer


def _point_in_poly(px, py, pts):
    n = len(pts)
    inside = False
    x1, y1 = pts[0]
    for i in range(1, n + 1):
        x2, y2 = pts[i % n]
        if ((y1 > py) != (y2 > py)) and (px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-9) + x1):
            inside = not inside
        x1, y1 = x2, y2
    return inside


def _draped_cloth_points(cx, cy, sw, sh, hang=0.16, flutter=0.045, n_half=8):
    """畫一塊柔軟垂墜的布:上緣微微飄動、下緣呈波浪狀垂墜,不是死板的四邊形。"""
    pts = []
    for i in range(n_half + 1):
        t = i / n_half
        x = cx - sw / 2 + t * sw
        y = cy - sh / 2 + math.sin(t * math.pi * 2.4 + 0.6) * sh * flutter
        pts.append((x, y))
    for i in range(1, n_half + 1):
        t = i / n_half
        x = cx + sw / 2 - t * sw
        y = cy + sh / 2 - abs(math.sin((1 - t) * math.pi * 3.5)) * sh * hang
        pts.append((x, y))
    return pts


def illus_paper(art_size, metallic=False):
    w, h = art_size
    cx, cy = w * 0.5, h * 0.5
    sw, sh = w * 0.68, h * 0.66
    # 鈦合金布垂墜感收斂一點(比較挺、有硬度),布則整塊都軟軟垂下來
    pts = _draped_cloth_points(cx, cy, sw, sh, hang=0.1 if metallic else 0.2,
                                flutter=0.03 if metallic else 0.05)
    layer = Image.new("RGBA", art_size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", art_size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 16, y + 22) for x, y in pts], fill=(20, 14, 10, 110))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16)))

    mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    if metallic:
        grad = directional_gradient(art_size, (232, 238, 244), (110, 122, 138), angle_deg=120)
    else:
        grad = directional_gradient(art_size, (255, 253, 246), (196, 186, 158), angle_deg=120)
    body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    body.paste(grad, (0, 0), mask)
    body = add_grain(body, seed=11, lo=224, hi=255, blur=0.35)
    layer.alpha_composite(body)

    # 折線改成一深一淺兩條夾角線,模擬折痕兩側的凹凸陰影,比單一顏色線條更有厚度感
    d = ImageDraw.Draw(layer)
    fold_dark = (70, 90, 106, 210) if metallic else (140, 118, 78, 190)
    fold_light = (255, 255, 255, 130) if metallic else (255, 250, 232, 150)
    for i in range(1, 4):
        t = i / 4
        x0 = cx - sw / 2 + 24 + t * (sw - 48)
        p0, p1 = (x0, cy - sh / 2 + 20), (x0 - 22, cy + sh / 2 - 24)
        d.line([p0, p1], fill=fold_dark, width=4, joint="curve")
        d.line([(p0[0] + 3, p0[1]), (p1[0] + 3, p1[1])], fill=fold_light, width=2, joint="curve")
    if metallic:
        # 不用一整條硬邊高光,改用短短幾段、角度略有差異的細高光,像金屬板反射環境的碎片光斑
        for k in range(3):
            y0 = cy - sh * (0.32 - k * 0.16)
            d.line([(cx - sw * 0.32, y0), (cx + sw * (0.2 - k * 0.05), y0 - sh * 0.05 + k * 6)],
                   fill=(255, 255, 255, 150 - k * 30), width=6 - k)
        # 布身雖然垂墜柔軟,挑幾個實際輪廓上的頂點切出銳利尖角、疊上高光,
        # 暗示這塊布其實是鈦合金材質,兼具軟布的垂墜跟金屬的堅硬稜角
        for idx in (2, len(pts) - 3):
            vx, vy = pts[idx]
            px2, py2 = pts[(idx - 1) % len(pts)]
            nx, ny = pts[(idx + 1) % len(pts)]
            spike = (vx + (vx - (px2 + nx) / 2) * 0.9, vy + (vy - (py2 + ny) / 2) * 0.9)
            d.polygon([pts[idx - 1], spike, pts[idx + 1]], fill=(232, 238, 244, 230))
            d.line([pts[idx - 1], spike], fill=(255, 255, 255, 230), width=2)
            d.line([spike, pts[idx + 1]], fill=(60, 72, 86, 220), width=2)
    else:
        # 紙纖維紋:一堆極細的隨機短線,增加紙張的纖維質感
        rnd = random.Random(23)
        for _ in range(50):
            fx = cx + rnd.uniform(-sw * 0.4, sw * 0.4)
            fy = cy + rnd.uniform(-sh * 0.42, sh * 0.42)
            ang = rnd.uniform(-0.3, 0.3) + math.pi / 2
            ln = rnd.uniform(8, 22)
            x1, y1 = fx - math.cos(ang) * ln / 2, fy - math.sin(ang) * ln / 2
            x2, y2 = fx + math.cos(ang) * ln / 2, fy + math.sin(ang) * ln / 2
            d.line([(x1, y1), (x2, y2)], fill=(120, 108, 80, 40), width=1)
    d.line(pts + [pts[0]], fill=((60, 68, 80, 255) if metallic else (70, 60, 40, 255)), width=5, joint="curve")
    return layer


def illus_scissors(art_size, laser=False):
    w, h = art_size
    cx, cy = w * 0.5, h * 0.52
    s = min(w, h) * 0.36
    layer = Image.new("RGBA", art_size, (0, 0, 0, 0))
    shadow = Image.new("RGBA", art_size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([cx - s * 0.8, cy + s * 0.55, cx + s * 0.8, cy + s * 0.8], fill=(15, 15, 20, 120))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))

    def blade(angle_deg, flip):
        # 用「中心線方向 + 垂直寬度」畫出一片有實際面積的刀刃(尖端收成一點),
        # 不是原本只有底部窄縫、往外變成細線的畸形四邊形
        rad = math.radians(angle_deg)
        dx, dy = math.cos(rad), -abs(math.sin(rad)) * flip
        dlen = math.hypot(dx, dy)
        dx, dy = dx / dlen, dy / dlen
        px, py = -dy, dx  # 垂直方向,用來給刀刃寬度
        tip = (cx + dx * s * 1.1, cy + dy * s * 1.1)
        base_c = (cx + dx * s * 0.08, cy + dy * s * 0.08)
        mid_c = (cx + dx * s * 0.48, cy + dy * s * 0.48)
        base_w, mid_w = 20, 15
        base_l = (base_c[0] - px * base_w, base_c[1] - py * base_w)
        base_r = (base_c[0] + px * base_w, base_c[1] + py * base_w)
        mid_l = (mid_c[0] - px * mid_w, mid_c[1] - py * mid_w)
        mid_r = (mid_c[0] + px * mid_w, mid_c[1] + py * mid_w)
        return [base_l, mid_l, tip, mid_r, base_r]

    blade_light = (150, 190, 214) if laser else (222, 226, 230)
    blade_dark = (24, 38, 50) if laser else (56, 62, 72)
    for ang, flip in [(36, 1), (36, -1)]:
        pts = blade(ang, flip)
        mask = Image.new("L", art_size, 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        grad = directional_gradient(art_size, blade_light, blade_dark, angle_deg=90 if flip > 0 else 270)
        body = Image.new("RGBA", art_size, (0, 0, 0, 0))
        body.paste(grad, (0, 0), mask)
        body = add_grain(body, seed=17 if flip > 0 else 19, lo=232, hi=255, blur=0.3)
        layer.alpha_composite(body)
        d = ImageDraw.Draw(layer)
        d.line(pts + [pts[0]], fill=(16, 20, 26, 255), width=4, joint="curve")
        # 刀鋒沿線加一道細細的高光,模擬磨過的鋼刃反光(不是整片高光,只在刃口)
        edge_hi = Image.new("RGBA", art_size, (0, 0, 0, 0))
        ImageDraw.Draw(edge_hi).line(pts[1:3], fill=(255, 255, 255, 130), width=2, joint="curve")
        layer.alpha_composite(edge_hi.filter(ImageFilter.GaussianBlur(1)))
        if laser:
            edge = Image.new("RGBA", art_size, (0, 0, 0, 0))
            ImageDraw.Draw(edge).line(pts[1:3], fill=(120, 220, 255, 230), width=6, joint="curve")
            layer.alpha_composite(edge.filter(ImageFilter.GaussianBlur(4)))

    d = ImageDraw.Draw(layer)
    handle_grad = directional_gradient(art_size, (108, 108, 116), (42, 42, 48), angle_deg=135)
    for flip in (1, -1):
        loop_c = (cx - s * 0.5, cy + s * 0.55 * flip)
        loop_mask = Image.new("L", art_size, 0)
        lm = ImageDraw.Draw(loop_mask)
        lm.ellipse([loop_c[0] - 36, loop_c[1] - 24, loop_c[0] + 36, loop_c[1] + 24], fill=255)
        lm.ellipse([loop_c[0] - 20, loop_c[1] - 12, loop_c[0] + 20, loop_c[1] + 12], fill=0)
        loop_body = Image.new("RGBA", art_size, (0, 0, 0, 0))
        loop_body.paste(handle_grad, (0, 0), loop_mask)
        layer.alpha_composite(add_grain(loop_body, seed=29, lo=225, hi=255, blur=0.4))
        d.ellipse([loop_c[0] - 36, loop_c[1] - 24, loop_c[0] + 36, loop_c[1] + 24],
                   outline=(18, 18, 22, 255), width=2)
        d.ellipse([loop_c[0] - 20, loop_c[1] - 12, loop_c[0] + 20, loop_c[1] + 12],
                   outline=(18, 18, 22, 255), width=2)
    grip_mask = Image.new("L", art_size, 0)
    gm = ImageDraw.Draw(grip_mask)
    gm.line([(cx - s * 0.16, cy), (cx - s * 0.5, cy + s * 0.55)], fill=255, width=15)
    gm.line([(cx - s * 0.16, cy), (cx - s * 0.5, cy - s * 0.55)], fill=255, width=15)
    grip_body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    grip_body.paste(handle_grad, (0, 0), grip_mask)
    layer.alpha_composite(add_grain(grip_body, seed=31, lo=225, hi=255, blur=0.4))
    d.line([(cx - s * 0.16, cy), (cx - s * 0.5, cy + s * 0.55)], fill=(18, 18, 22, 200), width=1)
    d.line([(cx - s * 0.16, cy), (cx - s * 0.5, cy - s * 0.55)], fill=(18, 18, 22, 200), width=1)
    d.ellipse([cx - 17, cy - 17, cx + 17, cy + 17], fill=(30, 30, 34, 255))
    d.ellipse([cx - 17, cy - 17, cx + 17, cy + 17], outline=(70, 70, 78, 255), width=2)
    d.ellipse([cx - 6, cy - 8, cx + 3, cy], fill=(180, 180, 190, 200))

    # 刀尖前方補幾道速度線,暗示剪刀正猛然一咬合下去,不是靜靜擺著的道具
    speed_col = (120, 220, 255, 150) if laser else (255, 255, 255, 90)
    for k in range(3):
        r0 = s * (1.18 + k * 0.1)
        r1 = s * (1.4 + k * 0.1)
        yoff = (k - 1) * s * 0.22
        d.line([(cx + r0, cy + yoff), (cx + r1, cy + yoff)], fill=speed_col, width=3 - (k % 2))

    # 整體斜轉一個角度,構圖從「平擺著的道具」變成「一把正要咬下去的剪刀」的動態帥氣姿勢
    layer = layer.rotate(-16, resample=Image.BICUBIC, center=(cx, cy))
    return layer


def _parched_sky_ground(art_size, sky_top, sky_bottom, ground_top, ground_bottom, horizon_t=0.6, seed=61):
    """烈陽/日蝕共用的場景底:天空+地平線+乾裂大地,不是單純的光暈貼在卡圖底色上。"""
    w, h = art_size
    horizon_y = int(h * horizon_t)
    sky = vertical_gradient((w, horizon_y + 2), sky_top, sky_bottom)
    ground = vertical_gradient((w, h - horizon_y), ground_top, ground_bottom)
    scene = Image.new("RGB", art_size)
    scene.paste(sky, (0, 0))
    scene.paste(ground, (0, horizon_y))
    scene = ImageChops.multiply(scene, noise_texture_rgb(art_size, seed=seed, lo=235, hi=255, blur=0.5))
    layer = scene.convert("RGBA")

    # 地面乾裂紋路:一撮撮從隨機起點延伸出去的折線裂縫
    rnd = random.Random(seed)
    d = ImageDraw.Draw(layer)
    for _ in range(11):
        x0 = rnd.uniform(0, w)
        y0 = rnd.uniform(horizon_y + 12, h - 10)
        pts = [(x0, y0)]
        ang = rnd.uniform(0, 2 * math.pi)
        for _ in range(rnd.randint(2, 4)):
            ang += rnd.uniform(-1.1, 1.1)
            length = rnd.uniform(18, 46)
            nx = pts[-1][0] + math.cos(ang) * length
            ny = pts[-1][1] + math.sin(ang) * length * 0.45
            ny = max(horizon_y + 6, min(h - 4, ny))
            pts.append((nx, ny))
        d.line(pts, fill=(46, 26, 14, 210), width=2, joint="curve")
    # 地平線加一道模糊的熱浪光暈,加強酷熱感
    haze = radial_glow_rgba(art_size, (255, 220, 160, 90), cx_t=0.5, cy_t=horizon_t, radius_t=0.5, feather=1.8)
    layer.alpha_composite(haze)
    return layer, horizon_y


def _draw_sun_disc(layer, cx, cy, r, core_light=(255, 250, 224), core_dark=(255, 140, 40),
                    ray_color=(255, 186, 74), rim=(140, 60, 10), n_rays=16, seed=43):
    art_size = layer.size
    d = ImageDraw.Draw(layer)
    rnd = random.Random(seed)
    for i in range(n_rays):
        ang = (2 * math.pi / n_rays) * i
        length = r * (2.1 if i % 2 == 0 else 1.5)
        w_ang = math.pi / n_rays * 0.55
        p1 = (cx + math.cos(ang - w_ang) * r * 0.7, cy + math.sin(ang - w_ang) * r * 0.7)
        p2 = (cx + math.cos(ang) * length, cy + math.sin(ang) * length)
        p3 = (cx + math.cos(ang + w_ang) * r * 0.7, cy + math.sin(ang + w_ang) * r * 0.7)
        tone = lerp(ray_color, rim, rnd.uniform(0, 0.3))
        d.polygon([p1, p2, p3], fill=tone + (235,))
    core_mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(core_mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    core_grad = directional_gradient(art_size, core_light, core_dark, angle_deg=135)
    core = Image.new("RGBA", art_size, (0, 0, 0, 0))
    core.paste(core_grad, (0, 0), core_mask)
    core = add_grain(core, seed=seed + 1, lo=228, hi=255, blur=0.4)
    layer.alpha_composite(core)
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=rim + (255,), width=5)
    d.ellipse([cx - r * 0.4, cy - r * 0.55, cx - r * 0.05, cy - r * 0.2], fill=(255, 255, 255, 160))


def illus_sun_burst(art_size):
    """烈陽:大太陽高掛天空,把底下的大地曬得又乾又裂,不是單純漂浮在卡圖底色上的光球。"""
    w, h = art_size
    layer, horizon_y = _parched_sky_ground(
        art_size, (255, 224, 158), (255, 158, 66), (172, 122, 68), (88, 56, 30), horizon_t=0.6)
    cx, cy = w * 0.52, horizon_y * 0.4
    r = min(w, h) * 0.2
    _draw_sun_disc(layer, cx, cy, r)
    return layer


def illus_eclipse(art_size):
    """日蝕:跟烈陽同一個天空+大地場景,但天光被啃掉大半、轉為壓迫感的橙紅暮色,
    加上一頭霸氣的漫畫式狼側臉咬向太陽,呼應天狗食日的傳說。"""
    w, h = art_size
    layer, horizon_y = _parched_sky_ground(
        art_size, (120, 62, 70), (70, 30, 40), (60, 34, 30), (24, 14, 14), horizon_t=0.6, seed=59)
    cx, cy = w * 0.52, horizon_y * 0.4
    r = min(w, h) * 0.2
    _draw_sun_disc(layer, cx, cy, r, core_light=(255, 236, 200), core_dark=(226, 96, 40),
                    ray_color=(224, 120, 60), rim=(90, 30, 10), seed=59)
    # 暗下來的天空補一層陰影,製造日蝕當下天色驟暗的壓迫感
    dim = Image.new("RGBA", art_size, (10, 4, 14, 110))
    dim_mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(dim_mask).rectangle([0, 0, w, horizon_y], fill=255)
    dim.putalpha(ImageChops.multiply(dim.split()[3], dim_mask))
    layer.alpha_composite(dim)

    # 側臉狼頭剪影(由左往右:後腦→尖耳→額頭→長吻→張口咬向太陽→下顎→喉嚨收回),
    # 大到直接咬住太陽的一角,線條銳利有霸氣,背光邊緣補一圈太陽透出的輪廓光
    wolf_cx, wolf_cy = cx + r * 0.95, cy - r * 0.15
    ws = r * 1.15
    wolf_pts = [
        (wolf_cx - ws * 0.5, wolf_cy + ws * 0.28),    # 喉嚨下緣
        (wolf_cx - ws * 0.56, wolf_cy - ws * 0.02),   # 後頸
        (wolf_cx - ws * 0.42, wolf_cy - ws * 0.34),   # 後腦
        (wolf_cx - ws * 0.3, wolf_cy - ws * 0.66),    # 耳後緣
        (wolf_cx - ws * 0.14, wolf_cy - ws * 0.88),   # 耳尖
        (wolf_cx - ws * 0.06, wolf_cy - ws * 0.5),    # 耳前緣接額頭
        (wolf_cx + ws * 0.1, wolf_cy - ws * 0.4),     # 額頭
        (wolf_cx + ws * 0.55, wolf_cy - ws * 0.14),   # 吻部上緣延伸
        (wolf_cx + ws * 0.82, wolf_cy - ws * 0.02),   # 鼻尖(上顎)
        (wolf_cx + ws * 0.6, wolf_cy + ws * 0.05),    # 上顎內側(嘴巴張開的縫)
        (wolf_cx + ws * 0.86, wolf_cy + ws * 0.24),   # 下顎尖(咬向太陽下緣)
        (wolf_cx + ws * 0.46, wolf_cy + ws * 0.2),    # 下顎內側
        (wolf_cx + ws * 0.28, wolf_cy + ws * 0.12),   # 下顎後緣接喉嚨
        (wolf_cx - ws * 0.1, wolf_cy + ws * 0.3),     # 喉嚨前緣
    ]
    wd = ImageDraw.Draw(layer)
    wd.polygon(wolf_pts, fill=(12, 7, 9, 255))
    # 上下獠牙,夾住嘴巴張開的縫隙
    wd.polygon([(wolf_cx + ws * 0.6, wolf_cy + ws * 0.05), (wolf_cx + ws * 0.68, wolf_cy + ws * 0.16),
                (wolf_cx + ws * 0.56, wolf_cy + ws * 0.1)], fill=(238, 232, 220, 255))
    wd.polygon([(wolf_cx + ws * 0.46, wolf_cy + ws * 0.2), (wolf_cx + ws * 0.54, wolf_cy + ws * 0.1),
                (wolf_cx + ws * 0.6, wolf_cy + ws * 0.18)], fill=(238, 232, 220, 255))
    # 瞇起的眼:一道細細發亮的縫,盯著太陽
    wd.line([(wolf_cx - ws * 0.02, wolf_cy - ws * 0.28), (wolf_cx + ws * 0.2, wolf_cy - ws * 0.24)],
            fill=(255, 210, 80, 255), width=4)
    # 背光輪廓:太陽在後方(嘴巴咬著的位置),狼的邊緣被襯出一圈暖光,加強逆光的霸氣感
    rim_layer = Image.new("RGBA", art_size, (0, 0, 0, 0))
    ImageDraw.Draw(rim_layer).line(wolf_pts + [wolf_pts[0]], fill=(255, 205, 130, 190), width=5, joint="curve")
    layer.alpha_composite(rim_layer.filter(ImageFilter.GaussianBlur(1.5)))
    wd = ImageDraw.Draw(layer)
    wd.polygon(wolf_pts, fill=(12, 7, 9, 255))
    wd.polygon([(wolf_cx + ws * 0.6, wolf_cy + ws * 0.05), (wolf_cx + ws * 0.68, wolf_cy + ws * 0.16),
                (wolf_cx + ws * 0.56, wolf_cy + ws * 0.1)], fill=(238, 232, 220, 255))
    wd.polygon([(wolf_cx + ws * 0.46, wolf_cy + ws * 0.2), (wolf_cx + ws * 0.54, wolf_cy + ws * 0.1),
                (wolf_cx + ws * 0.6, wolf_cy + ws * 0.18)], fill=(238, 232, 220, 255))
    wd.line([(wolf_cx - ws * 0.02, wolf_cy - ws * 0.28), (wolf_cx + ws * 0.2, wolf_cy - ws * 0.24)],
            fill=(255, 210, 80, 255), width=4)
    return layer


def illus_steal_hand(art_size, star_kind, smoke=False):
    """偷變剪刀/偷變布:魔術師的手(只畫手,不畫全身)變出對應的星星道具。
    只有手腕處加一圈袖口暗示「魔術師的手套」,偷變布另外加一團輕煙,呼應煙霧裡抽出布的畫面。"""
    w, h = art_size
    cx, cy = w * 0.5, h * 0.56
    s = min(w, h) * 0.32
    layer = radial_glow_rgba(art_size, (150, 90, 200, 130), cx_t=0.5, cy_t=0.48, radius_t=0.7, feather=1.3)

    if smoke:
        rnd_smoke = random.Random(67)
        for _ in range(6):
            sx = cx + rnd_smoke.uniform(-s * 0.9, s * 0.9)
            sy = cy + rnd_smoke.uniform(s * 0.1, s * 0.85)
            rr = rnd_smoke.uniform(s * 0.22, s * 0.4)
            puff = radial_glow_rgba(art_size, (235, 232, 240, 130), cx_t=sx / w, cy_t=sy / h,
                                     radius_t=rr / max(w, h), feather=1.1)
            layer.alpha_composite(puff)

    # 手掌輪廓改成頂端帶四個手指的鋸齒狀,而不是一整片圓弧,比較看得出是「手」不是長袍
    finger_tips_x = [cx - s * 0.32, cx - s * 0.08, cx + s * 0.16, cx + s * 0.4]
    finger_len = [s * 0.42, s * 0.5, s * 0.46, s * 0.36]
    palm = [(cx - s * 0.55, cy + s * 0.15), (cx - s * 0.6, cy - s * 0.18)]
    for fx, flen in zip(finger_tips_x, finger_len):
        palm.append((fx - s * 0.07, cy - s * 0.14))
        palm.append((fx, cy - s * 0.14 - flen))
        palm.append((fx + s * 0.07, cy - s * 0.14))
    palm += [(cx + s * 0.5, cy + s * 0.3), (cx + s * 0.2, cy + s * 0.7), (cx - s * 0.25, cy + s * 0.68)]
    thumb = [(cx - s * 0.55, cy + s * 0.1), (cx - s * 0.95, cy - s * 0.05), (cx - s * 0.8, cy + s * 0.35),
             (cx - s * 0.45, cy + s * 0.4)]

    mask = Image.new("L", art_size, 0)
    md = ImageDraw.Draw(mask)
    md.polygon(palm, fill=255)
    md.polygon(thumb, fill=255)
    grad = directional_gradient(art_size, (176, 138, 208), (72, 40, 104), angle_deg=140)
    body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    body.paste(grad, (0, 0), mask)
    body = add_grain(body, seed=61, lo=228, hi=255, blur=0.4)
    layer.alpha_composite(body)
    d = ImageDraw.Draw(layer)
    d.line(palm + [palm[0]], fill=(38, 18, 56, 255), width=5, joint="curve")
    d.line(thumb + [thumb[0]], fill=(38, 18, 56, 255), width=5, joint="curve")
    # 指節橫紋:每根手指上加一條淺色橫線,暗示關節,增加「手」的可讀性
    for fx, flen in zip(finger_tips_x, finger_len):
        knuckle_y = cy - s * 0.14 - flen * 0.55
        d.line([(fx - s * 0.06, knuckle_y), (fx + s * 0.06, knuckle_y)], fill=(120, 80, 150, 150), width=2)
    # 手腕處補一圈袖口,暗示這是魔術師從袖子裡伸出來的手,不是憑空的一隻手
    cuff_y = cy + s * 0.63
    d.line([(cx - s * 0.5, cuff_y - s * 0.06), (cx + s * 0.35, cuff_y + s * 0.04)],
           fill=(20, 10, 30, 255), width=10, joint="curve")
    d.line([(cx - s * 0.5, cuff_y - s * 0.11), (cx + s * 0.35, cuff_y - s * 0.02)],
           fill=(210, 180, 90, 220), width=2, joint="curve")

    icon_size = (int(s * 1.1), int(s * 1.1))
    if star_kind == "石頭":
        icon = illus_rock(icon_size)
    elif star_kind == "布":
        icon = illus_paper(icon_size, metallic=False)
    else:
        icon = illus_scissors(icon_size, laser=False)
    icon = icon.resize((int(s * 0.85), int(s * 0.85)))
    glow_box = radial_glow_rgba(art_size, (255, 240, 200, 180), cx_t=cx / w, cy_t=(cy - s * 0.05) / h,
                                 radius_t=0.28, feather=1.0)
    layer.alpha_composite(glow_box)
    layer.alpha_composite(icon, (int(cx - icon.size[0] / 2), int(cy - s * 0.05 - icon.size[1] / 2)))

    # 魔術變出來的小火花:幾顆四角星散在道具周圍,加強「變出來」的魔法感
    d = ImageDraw.Draw(layer)
    rnd_spark = random.Random(79)
    for _ in range(6):
        ang = rnd_spark.uniform(0, 2 * math.pi)
        dist = s * rnd_spark.uniform(0.55, 0.9)
        px = cx + math.cos(ang) * dist
        py = (cy - s * 0.05) + math.sin(ang) * dist * 0.8
        rr = rnd_spark.uniform(4, 9)
        d.line([(px - rr, py), (px + rr, py)], fill=(255, 250, 210, 220), width=2)
        d.line([(px, py - rr), (px, py + rr)], fill=(255, 250, 210, 220), width=2)
    return layer


def illus_spring_fist(art_size):
    """偷變石頭:一個驚喜箱子蓋子被彈開,裡面的彈簧拳頭衝了出來,不是手拿著石頭的畫面。"""
    w, h = art_size
    cx, cy = w * 0.5, h * 0.58
    s = min(w, h) * 0.3
    layer = radial_glow_rgba(art_size, (150, 90, 200, 130), cx_t=0.5, cy_t=0.5, radius_t=0.75, feather=1.3)

    box_top_y = cy + s * 0.25
    box_pts = [
        (cx - s * 0.62, box_top_y), (cx + s * 0.62, box_top_y),
        (cx + s * 0.72, cy + s * 0.95), (cx - s * 0.72, cy + s * 0.95),
    ]
    box_mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(box_mask).polygon(box_pts, fill=255)
    box_grad = directional_gradient(art_size, (214, 168, 96), (120, 82, 40), angle_deg=120)
    box_body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    box_body.paste(box_grad, (0, 0), box_mask)
    layer.alpha_composite(add_grain(box_body, seed=83, lo=215, hi=255, blur=0.4))
    d = ImageDraw.Draw(layer)
    d.polygon(box_pts, outline=(50, 30, 10, 255), width=4)
    d.line([(cx, box_top_y), (cx - s * 0.1, cy + s * 0.95)], fill=(90, 40, 30, 200), width=6)

    # 掀開的蓋子:翹向一邊,像剛剛被彈簧頂開一樣
    lid_pts = [(cx - s * 0.62, box_top_y), (cx + s * 0.62, box_top_y),
               (cx + s * 0.95, box_top_y - s * 0.55), (cx - s * 0.3, box_top_y - s * 0.42)]
    lid_mask = Image.new("L", art_size, 0)
    ImageDraw.Draw(lid_mask).polygon(lid_pts, fill=255)
    lid_body = Image.new("RGBA", art_size, (0, 0, 0, 0))
    lid_body.paste(box_grad, (0, 0), lid_mask)
    layer.alpha_composite(add_grain(lid_body, seed=84, lo=215, hi=255, blur=0.4))
    d = ImageDraw.Draw(layer)
    d.polygon(lid_pts, outline=(50, 30, 10, 255), width=3)

    # 彈簧:箱子開口到拳頭之間的鋸齒波浪線,畫粗一點,像被壓縮後彈開的線圈
    spring_top = cy - s * 0.55
    spring_bottom = box_top_y
    coils = 5
    spring_pts = []
    for i in range(coils * 2 + 1):
        t = i / (coils * 2)
        y = spring_bottom - t * (spring_bottom - spring_top)
        x = cx + (s * 0.28 if i % 2 == 0 else -s * 0.28)
        spring_pts.append((x, y))
    d.line(spring_pts, fill=(150, 150, 158, 255), width=9, joint="curve")
    d.line(spring_pts, fill=(210, 210, 218, 200), width=3, joint="curve")

    # 拳頭(拳擊手套風格):圓潤主體+大拇指凸起+縫線壓紋
    fist_cy = spring_top - s * 0.05
    fist_r = s * 0.42
    fist_pts_unit = [
        (-0.75, -0.2), (-0.5, -0.75), (0.05, -0.95), (0.65, -0.7), (0.95, -0.05),
        (0.7, 0.55), (0.05, 0.85), (-0.55, 0.6), (-0.85, 0.15),
    ]
    fist_pts = [(cx + ux * fist_r, fist_cy + uy * fist_r) for ux, uy in fist_pts_unit]
    fmask = Image.new("L", art_size, 0)
    ImageDraw.Draw(fmask).polygon(fist_pts, fill=255)
    fgrad = directional_gradient(art_size, (232, 96, 84), (120, 30, 26), angle_deg=130)
    fbody = Image.new("RGBA", art_size, (0, 0, 0, 0))
    fbody.paste(fgrad, (0, 0), fmask)
    layer.alpha_composite(add_grain(fbody, seed=85, lo=215, hi=255, blur=0.4))
    d = ImageDraw.Draw(layer)
    d.line(fist_pts + [fist_pts[0]], fill=(50, 14, 12, 255), width=5, joint="curve")
    for i in range(1, 4):
        xx = cx - fist_r * 0.5 + i * fist_r * 0.32
        d.line([(xx, fist_cy - fist_r * 0.7), (xx, fist_cy + fist_r * 0.3)], fill=(70, 20, 18, 180), width=2)

    thumb_pts = [(cx - fist_r * 0.85, fist_cy + fist_r * 0.1), (cx - fist_r * 1.25, fist_cy - fist_r * 0.15),
                 (cx - fist_r * 1.15, fist_cy + fist_r * 0.35), (cx - fist_r * 0.75, fist_cy + fist_r * 0.4)]
    tmask = Image.new("L", art_size, 0)
    ImageDraw.Draw(tmask).polygon(thumb_pts, fill=255)
    tbody = Image.new("RGBA", art_size, (0, 0, 0, 0))
    tbody.paste(fgrad, (0, 0), tmask)
    layer.alpha_composite(add_grain(tbody, seed=86, lo=215, hi=255, blur=0.4))
    d = ImageDraw.Draw(layer)
    d.line(thumb_pts + [thumb_pts[0]], fill=(50, 14, 12, 255), width=4, joint="curve")

    # 爆出的動感線,加強「突然彈出來」的驚喜感
    for ang in (-100, -70, -40, 220, 250):
        rad = math.radians(ang)
        x1 = cx + math.cos(rad) * fist_r * 1.15
        y1 = fist_cy + math.sin(rad) * fist_r * 1.15
        x2 = cx + math.cos(rad) * fist_r * 1.55
        y2 = fist_cy + math.sin(rad) * fist_r * 1.55
        d.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, 180), width=3)
    return layer


# ------------------------------------------------------------- 卡背 --

def build_back(theme_key, emblem):
    """卡背不放任何文字(含 Logo 字樣),純粹靠邊框材質 + 徽章圖案辨識種類。
    月亮卡背維持新月造型不變,星星/太陽卡背的徽章也一併補上材質處理跟前面的邊框一致。"""
    th = THEMES[theme_key]
    card = Image.new("RGB", (W, H), (10, 10, 12))
    bevel = diagonal_bevel_gradient((W, H), th["frame_light"], th["frame_mid"], th["frame_dark"])
    grain = noise_texture_rgb((W, H), seed=hash(theme_key + "back") % 5000, lo=222, hi=255, blur=0.5)
    bevel = ImageChops.multiply(bevel, grain)
    brushed = brushed_streaks_rgba((W, H), seed=(hash(theme_key + "back2")) % 5000, angle_deg=125,
                                    count=260, color=(255, 255, 255), alpha=10)
    bevel = Image.alpha_composite(bevel.convert("RGBA"), brushed).convert("RGB")
    card.paste(bevel, (0, 0), rounded_mask((W, H), 34))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=34, outline=(0, 0, 0), width=6)
    pad = 40
    draw.rounded_rectangle([pad, pad, W - pad, H - pad], radius=20, outline=(20, 16, 10), width=6)
    draw.rounded_rectangle([pad + 16, pad + 16, W - pad - 16, H - pad - 16], radius=14,
                            outline=lerp(th["frame_dark"], (0, 0, 0), 0.35), width=2)
    cx, cy = W / 2, H / 2
    glow = radial_glow_rgba((W, H), lerp(th["badge"], (0, 0, 0), 0.2) + (90,), cx_t=0.5, cy_t=0.5,
                             radius_t=0.34, feather=1.2)
    card = Image.alpha_composite(card.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(card)
    for rr, col in [(258, lerp(th["frame_dark"], (0, 0, 0), 0.45)),
                     (192, lerp(th["frame_mid"], (0, 0, 0), 0.2)),
                     (126, lerp(th["badge"], (0, 0, 0), 0.1))]:
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=col, width=5)
    emblem(draw, cx, cy, 168, th)
    return card


def _emblem_star(draw, cx, cy, r, th):
    # 先畫暗面的實心星星,再疊一顆往左上偏移、縮小一點的亮面星星,做出鑄造徽章的刻面感,
    # 不靠一圈白色高光outline
    pts_dark = []
    pts_light = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        pts_dark.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
        rr2 = rr * 0.86
        pts_light.append((cx - r * 0.06 + math.cos(ang) * rr2, cy - r * 0.06 + math.sin(ang) * rr2))
    draw.polygon(pts_dark, fill=lerp(th["badge"], (0, 0, 0), 0.35), outline=(15, 12, 10), width=3)
    draw.polygon(pts_light, fill=lerp(th["badge"], (255, 255, 255), 0.15))


def _emblem_sun(draw, cx, cy, r, th):
    for i in range(12):
        ang = (math.pi / 6) * i
        shade = 0.15 if i % 2 == 0 else 0.35
        x1, y1 = cx + math.cos(ang) * r * 0.55, cy + math.sin(ang) * r * 0.55
        x2, y2 = cx + math.cos(ang) * r * 1.05, cy + math.sin(ang) * r * 1.05
        draw.line([(x1, y1), (x2, y2)], fill=lerp(th["badge"], (0, 0, 0), shade), width=10)
    draw.ellipse([cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55],
                 fill=lerp(th["badge"], (0, 0, 0), 0.2), outline=(15, 12, 10), width=3)
    draw.ellipse([cx - r * 0.42, cy - r * 0.5, cx + r * 0.3, cy + r * 0.22],
                 fill=lerp(th["badge"], (255, 255, 255), 0.18))


def _emblem_moon(draw, cx, cy, r, th):
    # 保留新月造型:主圓 + 位移的暗色圓挖出弦月缺角,只是把純白外框換成暗色刻線、主體改成柔和的雙色調
    draw.ellipse([cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6],
                 fill=lerp(th["badge"], (255, 255, 255), 0.08))
    draw.ellipse([cx - r * 0.6 + r * 0.42, cy - r * 0.6, cx + r * 0.6 + r * 0.42, cy + r * 0.6],
                 fill=(24, 22, 26))
    draw.ellipse([cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6],
                 outline=(15, 12, 10), width=3)


# ------------------------------------------------------------- 產卡設定 --

def paste_art(card, art_box, illus_img):
    aw = art_box[2] - art_box[0]
    ah = art_box[3] - art_box[1]
    illus_img = illus_img.resize((aw, ah)) if illus_img.size != (aw, ah) else illus_img
    card = card.convert("RGBA")
    card.alpha_composite(illus_img, (art_box[0], art_box[1]))
    return card.convert("RGB")


# --------------------------------------------------- 外部(AI 生成)插畫整合 --
# 卡框/名條/圓標/效果文字框都是這支程式自己畫的,已經調過好幾輪、風格穩定,
# 不需要重做。只有「卡圖插畫本體」換成外部圖檔(例如用 ChatGPT/Midjourney 生成),
# 這裡負責把任意尺寸的圖片「填滿裁切」(cover fit)成剛好塞進 art_box 的大小,
# 不失真地置中裁掉多的部分,讓你不用管生成圖片確切要多大。

SOURCE_ART_DIR = os.path.join(os.path.dirname(__file__), "cardgen_source_art")
SOURCE_ART_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def find_source_art(name, source_dir=SOURCE_ART_DIR):
    """在來源資料夾裡找 {name}.png / .jpg / .jpeg / .webp,回傳路徑或 None(找不到)。"""
    for ext in SOURCE_ART_EXTS:
        p = os.path.join(source_dir, name + ext)
        if os.path.exists(p):
            return p
    return None


def load_cover_fit(path, target_size):
    """讀外部圖檔,用「填滿裁切」縮放成 target_size:短邊先縮到填滿,
    長邊置中裁掉多餘部分,圖片本身沒有透明背景也沒關係,直接整塊蓋滿 art_box。"""
    tw, th = target_size
    img = Image.open(path).convert("RGBA")
    sw, sh = img.size
    scale = max(tw / sw, th / sh)
    nw, nh = max(1, round(sw * scale)), max(1, round(sh * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    x0 = (nw - tw) // 2
    y0 = (nh - th) // 2
    return img.crop((x0, y0, x0 + tw, y0 + th))


def generate_from_external_art(source_dir=SOURCE_ART_DIR, out_dir=OUT_DIR):
    """跟 generate_all() 一樣產完整套卡,但插畫本體優先用 source_dir 裡的外部圖檔;
    某張卡還沒生成外部圖檔的話,自動退回用程式內建的插畫(illus_fn)頂著,
    這樣可以一張一張慢慢補圖、不用等全部湊齊才能重新產卡。"""
    os.makedirs(out_dir, exist_ok=True)
    for name, theme_key, effect, illus_fn in CARDS:
        card, art_box = build_frame(theme_key, name, kind_line_for(theme_key), effect)
        aw, ah = art_box[2] - art_box[0], art_box[3] - art_box[1]
        src = find_source_art(name, source_dir)
        if src:
            illus_img = load_cover_fit(src, (aw, ah))
            print(f"{name}: 使用外部圖檔 {src}")
        else:
            illus_img = illus_fn((aw, ah))
            print(f"{name}: 找不到外部圖檔,沿用內建插畫")
        card = paste_art(card, art_box, illus_img)
        path = os.path.join(out_dir, f"{name}.png")
        card.save(path)
        print("saved", path)
    for fname, theme_key, emblem in BACKS:
        card = build_back(theme_key, emblem)
        path = os.path.join(out_dir, f"{fname}.png")
        card.save(path)
        print("saved", path)


CARDS = [
    ("石頭", "star", "可以贏剪刀。", lambda size: illus_rock(size)),
    ("布", "star", "可以贏石頭。", lambda size: illus_paper(size)),
    ("剪刀", "star", "可以贏布。", lambda size: illus_scissors(size)),
    ("殞石頭", "sun", "①:本回合星星卡為「石頭」時可以發動,升級為殞石頭。若星星卡不是「石頭」時則視為發動無效並丟棄。",
     lambda size: illus_meteor(size)),
    ("雷射剪刀", "sun", "①:本回合星星卡為「剪刀」時可以發動,升級為雷射剪刀。若星星卡不是「剪刀」時則視為發動無效並丟棄。",
     lambda size: illus_scissors(size, laser=True)),
    ("鈦合金布", "sun", "①:本回合星星卡為「布」時可以發動,升級為鈦合金布。若星星卡不是「布」時則視為發動無效並丟棄。",
     lambda size: illus_paper(size, metallic=True)),
    ("烈陽", "sun",
     "①:可指定自己或對手,從太陽或月亮牌庫抽1張。\n②:偷看對手的星星與蓋著的月亮卡,並將其強制發動或強制丟棄。\n※①②效果1回合限用其一。",
     lambda size: illus_sun_burst(size)),
    ("偷變石頭", "moon", "①:可以發動,將自己本回合的星星變更為「石頭」。",
     lambda size: illus_spring_fist(size)),
    ("偷變剪刀", "moon", "①:可以發動,將自己本回合的星星變更為「剪刀」。",
     lambda size: illus_steal_hand(size, "剪刀")),
    ("偷變布", "moon", "①:可以發動,將自己本回合的星星變更為「布」。",
     lambda size: illus_steal_hand(size, "布", smoke=True)),
    ("日蝕", "moon",
     "①:對手發動烈陽時可發動,使其無效並丟棄,指定自己或對手抽2張(太陽/月亮牌庫自由選)。\n"
     "②:可發動,使對手太陽卡效果無效。\n※①②效果1回合限用其一。",
     lambda size: illus_eclipse(size)),
]

BACKS = [
    ("back_star", "star", _emblem_star),
    ("back_sun", "sun", _emblem_sun),
    ("back_moon", "moon", _emblem_moon),
]


def kind_line_for(theme_key):
    return "【" + THEMES[theme_key]["kind_label"] + "】"


def generate_board_texture(size=256, seed=99):
    """遊戲桌面(場地)用的可平鋪材質:菱格壓紋(像牌桌氈布車縫線)+ 顆粒雜訊,
    靠 CSS background-blend-mode: multiply 疊在既有的深色面板底色上,讓場地也有實際的「圖案」,
    不是單純調暗的雜訊而已。菱格對角線間距整除 size,平鋪不會露接縫。"""
    tex = Image.new("L", (size, size), 255)
    px = tex.load()
    rnd = random.Random(seed)
    for y in range(size):
        for x in range(size):
            px[x, y] = rnd.randint(222, 255)
    tex = tex.filter(ImageFilter.GaussianBlur(0.5))
    d = ImageDraw.Draw(tex)
    step = size // 4
    # 車縫菱格線:兩組對角線交叉,線本身用稍微深一點的顏色,模擬絎縫牌桌氈布的縫線
    for offset in range(-size, size * 2, step):
        d.line([(offset, 0), (offset + size, size)], fill=205, width=2)
        d.line([(offset, size), (offset + size, 0)], fill=205, width=2)
    # 菱格交叉點壓一個小凹點,增加立體感
    for gx in range(0, size + 1, step):
        for gy in range(0, size + 1, step):
            d.ellipse([gx - 3, gy - 3, gx + 3, gy + 3], fill=196)
    return tex.convert("RGB")


def generate_all():
    for name, theme_key, effect, illus_fn in CARDS:
        card, art_box = build_frame(theme_key, name, kind_line_for(theme_key), effect)
        aw, ah = art_box[2] - art_box[0], art_box[3] - art_box[1]
        illus_img = illus_fn((aw, ah))
        card = paste_art(card, art_box, illus_img)
        path = os.path.join(OUT_DIR, f"{name}.png")
        card.save(path)
        print("saved", path)
    for fname, theme_key, emblem in BACKS:
        card = build_back(theme_key, emblem)
        path = os.path.join(OUT_DIR, f"{fname}.png")
        card.save(path)
        print("saved", path)


if __name__ == "__main__":
    import sys
    if "--external" in sys.argv:
        generate_from_external_art()
    else:
        generate_all()
