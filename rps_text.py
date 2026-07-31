#!/usr/bin/env python3
"""
猜☆拳☆王 — 純文字版(終端機執行,不需要任何額外套件)

執行方式:
    python rps_text.py
"""

from rps_core import Game, GameOver, RULES_TEXT


class TextUI:
    def log(self, text):
        print(text)

    def choose(self, title, prompt, options):
        print(f"\n[{title}] {prompt}")
        for i, (label, _val) in enumerate(options, start=1):
            print(f"  {i}. {label}")
        while True:
            raw = input(f"請輸入選項編號(1-{len(options)}):").strip()
            if raw.isdigit() and 1 <= int(raw) <= len(options):
                return options[int(raw) - 1][1]
            print("輸入無效,請再試一次。")

    def confirm(self, title, prompt):
        print(f"\n[{title}] {prompt}")
        while True:
            raw = input("是否執行?(y/n):").strip().lower()
            if raw in ("y", "yes", "是"):
                return True
            if raw in ("n", "no", "否"):
                return False
            print("輸入無效,請輸入 y 或 n。")

    def info(self, title, msg):
        print(f"\n=== {title} ===")
        print(msg)
        input("(按 Enter 繼續)")


def main():
    print("=" * 60)
    print("猜☆拳☆王 — 純文字版")
    print("=" * 60)
    print(RULES_TEXT)

    ui = TextUI()
    diff = ui.choose("選擇難度", "請選擇 AI 難度:", [("簡單", "easy"), ("普通", "normal"), ("困難", "hard")])

    while True:
        game = Game(ui, difficulty=diff)
        try:
            while True:
                input("\n---- 按 Enter 進行下一回合 ----")
                game.play_round()
        except GameOver as e:
            print(f"\n★★★ 遊戲結束!獲勝者:{e.winner.name} ★★★")

        again = ui.confirm("再來一局", "要重新開始一局嗎?")
        if not again:
            break
        diff = ui.choose("選擇難度", "請選擇 AI 難度:", [("簡單", "easy"), ("普通", "normal"), ("困難", "hard")])

    print("感謝遊玩,再見!")


if __name__ == "__main__":
    main()
