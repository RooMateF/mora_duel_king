#!/usr/bin/env python3
"""
猜☆拳☆王 — 圖形版(單人 vs AI)
規則邏輯共用 rps_core.py。僅使用 Python 標準函式庫(tkinter),不需額外安裝套件。

目前卡片是用色塊+文字畫的簡易畫面,之後要換成 PNG 圖片時,
只要修改 GameGUI._draw_card() 這一個函式即可(其他地方都呼叫它畫卡)。

執行方式:
    python rps_game.py
"""

import tkinter as tk
from tkinter import messagebox

from rps_core import Game, GameOver, STAR_TYPES, RULES_TEXT

COLOR_STAR = "#3b6ea5"
COLOR_SUN = "#c96b1f"
COLOR_MOON = "#6a3fa0"
COLOR_EMPTY = "#33363f"
COLOR_TEXT = "#eaeaea"
COLOR_TEXT_DIM = "#6d7278"
BG_BAND_A = "#262a33"
BG_BAND_MID = "#1b1d24"


class GameGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("猜☆拳☆王 — 圖形版")
        self.root.geometry("960x720")
        self.root.minsize(640, 480)
        self.game = None

        self.canvas = tk.Canvas(root, bg=BG_BAND_MID, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Configure>", lambda e: self.redraw_canvas())

        log_frame = tk.Frame(root)
        log_frame.pack(fill="x")
        self.log_text = tk.Text(log_frame, height=9, state="disabled", wrap="word",
                                 font=("Consolas", 10), bg="#101114", fg="#d8d8d8")
        scrollbar = tk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        ctrl = tk.Frame(root, padx=8, pady=6)
        ctrl.pack(fill="x")
        self.next_btn = tk.Button(ctrl, text="下一回合 ▶", command=self.on_next_round, width=16)
        self.next_btn.pack(side="left")
        tk.Button(ctrl, text="重新開始", command=self.on_restart, width=12).pack(side="left", padx=6)
        tk.Button(ctrl, text="規則說明", command=self.show_rules, width=12).pack(side="left")

        self.start_new_game()

    # -- log / dialogs(rps_core 需要的介面) --------------------------

    def log(self, text):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")
        self.redraw_canvas()
        self.root.update_idletasks()

    def choose(self, title, prompt, options):
        result = {"value": None}
        win = tk.Toplevel(self.root)
        win.title(title)
        win.transient(self.root)
        win.grab_set()
        win.resizable(False, False)
        tk.Label(win, text=prompt, justify="left", padx=14, pady=10, wraplength=380).pack()
        frame = tk.Frame(win)
        frame.pack(pady=6, padx=12)
        for label, val in options:
            tk.Button(
                frame, text=label, width=34,
                command=lambda v=val: (result.__setitem__("value", v), win.destroy()),
            ).pack(pady=2)
        win.protocol("WM_DELETE_WINDOW", lambda: win.destroy())
        win.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() - win.winfo_width()) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - win.winfo_height()) // 2
        win.geometry(f"+{max(x,0)}+{max(y,0)}")
        self.root.wait_window(win)
        self.redraw_canvas()
        return result["value"]

    def confirm(self, title, prompt):
        r = messagebox.askyesno(title, prompt, parent=self.root)
        self.redraw_canvas()
        return r

    def info(self, title, msg):
        messagebox.showinfo(title, msg, parent=self.root)
        self.redraw_canvas()

    # -- 遊戲控制 ---------------------------------------------------

    def start_new_game(self):
        diff = self.choose(
            "選擇難度", "請選擇 AI 難度:",
            [("簡單", "easy"), ("普通", "normal"), ("困難", "hard")],
        ) or "normal"
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")
        self.game = Game(self, difficulty=diff)
        self.next_btn.config(state="normal")
        self.redraw_canvas()
        self.log("遊戲開始!點擊「下一回合」開始遊玩。")

    def on_restart(self):
        if self.confirm("重新開始", "確定要放棄目前進度、重新開始一局嗎?"):
            self.start_new_game()

    def on_next_round(self):
        try:
            self.game.play_round()
        except GameOver as e:
            self.log(f"\n★★★ 遊戲結束!獲勝者:{e.winner.name} ★★★")
            self.next_btn.config(state="disabled")
            self.info("遊戲結束", f"{e.winner.name} 獲勝!")
        self.redraw_canvas()

    def show_rules(self):
        win = tk.Toplevel(self.root)
        win.title("規則說明")
        win.geometry("640x560")
        win.transient(self.root)
        text = tk.Text(win, wrap="word", font=("Microsoft JhengHei UI", 10), padx=10, pady=10)
        scrollbar = tk.Scrollbar(win, command=text.yview)
        text.configure(yscrollcommand=scrollbar.set)
        text.insert("1.0", RULES_TEXT)
        text.configure(state="disabled")
        text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        tk.Button(win, text="關閉", command=win.destroy).pack(side="bottom", pady=6)

    # -- 畫面繪製 ---------------------------------------------------

    def redraw_canvas(self):
        c = self.canvas
        c.delete("all")
        if not self.game:
            return
        w = c.winfo_width()
        h = c.winfo_height()
        if w < 20 or h < 20:
            return
        top_h = int(h * 0.34)
        bot_h = int(h * 0.34)
        mid_h = h - top_h - bot_h

        c.create_rectangle(0, 0, w, top_h, fill=BG_BAND_A, outline="")
        c.create_rectangle(0, top_h, w, top_h + mid_h, fill=BG_BAND_MID, outline="")
        c.create_rectangle(0, top_h + mid_h, w, h, fill=BG_BAND_A, outline="")

        g = self.game
        self._draw_player_band(c, g.ai, 0, top_h, w, True)
        self._draw_battlefield(c, top_h, mid_h, w)
        self._draw_player_band(c, g.human, top_h + mid_h, bot_h, w, False)

        status = f"第 {g.round_num} 回合　難度:{g.difficulty}"
        c.create_text(w / 2, top_h + 12, fill="#9aa0a8", font=("Microsoft JhengHei UI", 9), text=status)

    def _draw_card(self, c, x, y, w, h, text, color, empty=False, back=False, header=None):
        if header:
            c.create_text(x + w / 2, y - 9, fill="#8a8f99", font=("Microsoft JhengHei UI", 8), text=header)
        fill = COLOR_EMPTY if empty else color
        c.create_rectangle(x, y, x + w, y + h, fill=fill, outline="#0d0e11", width=2)
        if back and not empty:
            c.create_line(x + 6, y + 6, x + w - 6, y + h - 6, fill="#1a1a1a")
            c.create_line(x + w - 6, y + 6, x + 6, y + h - 6, fill="#1a1a1a")
        c.create_text(
            x + w / 2, y + h / 2,
            fill=(COLOR_TEXT_DIM if empty else COLOR_TEXT),
            font=("Microsoft JhengHei UI", 9, "normal" if empty else "bold"),
            text=text, width=w - 6,
        )

    def _draw_badge(self, c, x, y, w, h, text, color):
        c.create_rectangle(x, y, x + w, y + h, fill=color, outline="#0d0e11", width=1)
        c.create_text(x + w / 2, y + h / 2, fill="white", font=("Microsoft JhengHei UI", 9, "bold"), text=text)

    def _draw_pile_stack(self, c, x, y, w, h, label, count, color):
        empty = count == 0
        self._draw_card(c, x, y, w, h, f"x{count}", color, empty=empty, back=True, header=label)

    def _draw_player_band(self, c, player, y0, band_h, w, is_ai):
        pad = 14
        c.create_text(pad, y0 + 16, anchor="w", fill="white",
                       font=("Microsoft JhengHei UI", 12, "bold"),
                       text=("電腦" if is_ai else "你"))

        star_y = y0 + 38
        sx = pad
        for t in STAR_TYPES:
            self._draw_badge(c, sx, star_y, 58, 26, f"{t} {player.stars[t]}", COLOR_STAR)
            sx += 64

        deck_w, deck_h = 58, 42
        dx = w - pad - deck_w
        for label, cnt, color in (
            ("棄牌", len(player.discard), "#555a63"),
            ("月亮庫", len(player.moon_pile), COLOR_MOON),
            ("太陽庫", len(player.sun_pile), COLOR_SUN),
        ):
            self._draw_pile_stack(c, dx, y0 + 8, deck_w, deck_h, label, cnt, color)
            dx -= deck_w + 10

        hand_y = y0 + band_h - 56
        if is_ai:
            hx = pad
            self._draw_pile_stack(c, hx, hand_y, 58, 42, "太陽手牌", len(player.hand_sun), COLOR_SUN)
            hx += 72
            self._draw_pile_stack(c, hx, hand_y, 58, 42, "月亮手牌", len(player.hand_moon), COLOR_MOON)
        else:
            hx = pad
            cards = [(c2, COLOR_SUN) for c2 in player.hand_sun] + [(c2, COLOR_MOON) for c2 in player.hand_moon]
            if not cards:
                c.create_text(hx, hand_y + 21, anchor="w", fill=COLOR_TEXT_DIM,
                               font=("Microsoft JhengHei UI", 9), text="(手上沒有太陽/月亮卡)")
            for card_name, color in cards:
                self._draw_card(c, hx, hand_y, 64, 42, card_name, color, header=None)
                hx += 72

    def _draw_battlefield(self, c, y0, band_h, w):
        g = self.game
        col_w = w / 2

        def draw_side(cx0, player, is_ai):
            c.create_text(cx0 + col_w / 2, y0 + 14, fill="#c9ccd1",
                           font=("Microsoft JhengHei UI", 10, "bold"),
                           text=f"{'電腦' if is_ai else '你'}的出牌")
            slot_w, slot_h = 72, 44
            gap = 14
            total_w = slot_w * 3 + gap * 2
            start_x = cx0 + (col_w - total_w) / 2
            y = y0 + band_h / 2 - slot_h / 2 + 8

            sun_cards = player.played_sun_cards
            sun_label = "、".join(sun_cards) if sun_cards else "—"
            self._draw_card(c, start_x, y, slot_w, slot_h, sun_label, COLOR_SUN,
                             empty=not sun_cards, header="太陽")

            sx = start_x + slot_w + gap
            if is_ai and not g.stars_revealed:
                self._draw_card(c, sx, y, slot_w, slot_h, "?", "#4a4f5a", header="星星", back=True)
            else:
                star_label = player.committed_star or "—"
                self._draw_card(c, sx, y, slot_w, slot_h, star_label, COLOR_STAR,
                                 empty=(player.committed_star is None), header="星星")

            mx = sx + slot_w + gap
            if player.moon_decided:
                moon_card = player.played_moon_card
                self._draw_card(c, mx, y, slot_w, slot_h, moon_card or "—", COLOR_MOON,
                                 empty=not moon_card, header="月亮")
            elif player.pending_moon_card is None:
                self._draw_card(c, mx, y, slot_w, slot_h, "—", COLOR_MOON, empty=True, header="月亮")
            elif is_ai:
                self._draw_card(c, mx, y, slot_w, slot_h, "?", "#4a4f5a", header="月亮", back=True)
            else:
                self._draw_card(c, mx, y, slot_w, slot_h, player.pending_moon_card, COLOR_MOON, header="月亮")

        draw_side(0, g.ai, True)
        draw_side(col_w, g.human, False)
        c.create_line(w / 2, y0 + 6, w / 2, y0 + band_h - 6, fill="#3a3e47", dash=(4, 2))


def main():
    root = tk.Tk()
    GameGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
