"""
猜拳卡牌遊戲 — 共用規則引擎(文字版 / 圖形版共用)
規則來源:RPS_Card_Game_Design.md,以及後續追加規則:
  - 烈陽效果一:偷看後,對手本回合月亮階段必須打出並發動一張月亮卡(不能選不出)。
  - 日蝕反制烈陽成功:反制方可再指定自己或對手,抽兩張牌(太陽、月亮牌庫自由選,不限一邊一張)。
  - 平手抽牌:只要太陽或月亮牌庫還有牌就強制抽一張(自選堆);兩堆皆空才可不抽、不判負。

此模組不依賴任何 GUI 套件。UI(文字版 rps_text.py / 圖形版 rps_game.py)
需提供一個 gui 物件,實作以下介面:
    gui.log(text: str) -> None
    gui.choose(title: str, prompt: str, options: list[tuple[str, Any]]) -> Any | None
    gui.confirm(title: str, prompt: str) -> bool
    gui.info(title: str, msg: str) -> None
"""

import random
from collections import Counter

STAR_TYPES = ["石頭", "布", "剪刀"]
SUN_CARDS_ALL = ["殞石頭", "雷射剪刀", "鈦合金布", "烈陽"]
MOON_CARDS_ALL = ["偷變石頭", "偷變剪刀", "偷變布", "日蝕"]

SUN_EVOLVE = {  # 太陽卡 -> (需要的底牌星星, 進化後棋子)
    "殞石頭": ("石頭", "殞石頭"),
    "雷射剪刀": ("剪刀", "雷射剪刀"),
    "鈦合金布": ("布", "鈦合金布"),
}
MOON_STEAL = {  # 月亮卡 -> 偷變成的星星
    "偷變石頭": "石頭",
    "偷變剪刀": "剪刀",
    "偷變布": "布",
}

FINAL_ORDER = ["石頭", "布", "剪刀", "殞石頭", "雷射剪刀", "鈦合金布"]
IDX = {name: i for i, name in enumerate(FINAL_ORDER)}
# MATRIX[a][b]: 站在 a 的角度,對上 b 的結果 (1=贏 0=平 -1=輸)
MATRIX = [
    [0, -1, 1, -1, 0, -1],
    [1, 0, -1, 0, -1, -1],
    [-1, 1, 0, -1, -1, 0],
    [1, 0, 1, 0, 1, -1],
    [0, 1, 1, -1, 0, 1],
    [1, 1, 0, 1, -1, 0],
]

RULES_TEXT = """\
================ 簡單規則(先看這裡就能玩) ================

【遊戲目標】
雙方輪流出牌,誰先被逼到「太陽牌庫和月亮牌庫都抽不出牌」,誰就輸了。

【每回合基本流程】
1. 雙方各出一張「星星卡」(石頭/布/剪刀),這是每回合決定勝負的主軸。
2. 雙方也可以打「太陽卡」讓自己的星星升級,或打「月亮卡」偷改自己的星星、干擾對方。
3. 比完出招後,輸的人被拿走一張星星卡、還要抽牌;贏的人不用抽牌。

【回合內出牌順序】
先攻蓋星星 → 後攻蓋星星 → 先攻蓋月亮(可不蓋) → 後攻蓋月亮(可不蓋)
→ 先攻決定太陽卡 → 後攻決定太陽卡 → 先攻揭星星 → 後攻揭星星
→ 後攻決定要不要發動蓋著的月亮卡 → 先攻決定要不要發動蓋著的月亮卡
星星跟月亮都是「先蓋牌、後面才決定/揭曉」,太陽卡則是當下直接決定、沒有蓋牌這一步。
日蝕要先蓋出去才能用(跟所有月亮卡一樣);對方打出烈陽的當下,可以提前發動蓋著的日蝕來反制(不用等到月亮階段),但只能擇一使用——用來反制過的日蝕,月亮階段就不會再有它了。
若蓋牌後最後決定不發動,那張牌直接收回手上,等於沒打。

【星星卡 —— 基本猜拳】
石頭 贏 剪刀、剪刀 贏 布、布 贏 石頭(一般猜拳規則)。

【太陽卡 —— 讓星星升級 / 特殊效果】
- 殞石頭 / 雷射剪刀 / 鈦合金布:
  打出後,把你這回合出的「對應星星」升級(殞石頭配石頭、雷射剪刀配剪刀、鈦合金布配布)。
  升級後的星星打普通星星只會贏或平、絕不會輸。三張升級星星之間也有克制循環:
      殞石頭 剋 雷射剪刀 剋 鈦合金布 剋 殞石頭
- 烈陽(打出時二選一效果):
  A. 偷看:偷看對方這回合出的星星、以及對方手上的月亮卡,而且你可以「再多打一張太陽卡」。
     代價:對方被偷看後,這回合月亮階段「必須」打出並使用一張月亮卡(不能選擇不出)。
  B. 逼抽:指定「自己」或「對方」,從太陽牌庫或月亮牌庫(自選一堆)抽一張牌。

【月亮卡 —— 偷改自己的出招 / 反制對方】
- 偷變石頭 / 偷變剪刀 / 偷變布:
  在月亮階段,把「自己」這回合出的星星直接換成指定的那一種(即使之前升級過,也會蓋掉、變回換成的那個基本星星)。
- 日蝕(必須先蓋出去才能用,二選一效果,擇一使用後這張就用掉了):
  A. 反制烈陽:對方打出烈陽的當下,可以提前發動蓋著的日蝕,讓那次烈陽失效、直接報廢。
     反制成功後,你可以再指定自己或對方,抽兩張牌(太陽、月亮牌庫自由選,不限一邊一張)。
  B. 主動使用:如果沒有拿去反制,月亮階段可以正常發動,讓對方這回合打出的太陽卡效果直接失效。

【勝負與抽牌(簡化版)】
- 比出最終出招,強的一方贏這回合。
- 贏家:拿走輸家這回合出的那張星星卡(同型 -1)。
- 輸家:抽牌 1 張太陽 + 1 張月亮。
- 平手:雙方各自抽 1 張(自己選太陽或月亮堆);如果兩堆都空了,不用抽。
- 需要抽牌時,如果太陽、月亮兩個牌庫都已經空了 → 直接判負。


================ 詳細判定細則(進階/邊界情況) ================

1. 太陽卡型別不符:打出升級太陽卡時,若這回合出的星星不是它要求的型別,該太陽卡不會升級,而且**直接收回手牌**(不進棄牌區),下回合可以再打;但若升級有生效、卻被對方日蝕主動效果打掉,那張太陽卡依然正常進棄牌區。
2. 偷變的限制:如果這回合根本沒出星星卡,「偷變」卡打出後不會有任何效果(仍會進棄牌區)。
3. 完全沒星星可出:若手上三種星星卡都已是 0 張,本回合視為出不了牌,直接算輸掉這回合。
4. 效果套用順序:星星底牌 → 太陽升級(型別相符才生效) → 月亮偷變(會蓋掉升級結果) → 日蝕主動效果(使對方太陽失效)。
5. 烈陽逼抽的邊界:指定的那一堆已空 → 不執行、無事發生;但若指定對象的太陽、月亮兩堆「同時」都空 → 該對象直接判負。
6. 抽牌邊界:輸家抽2張是固定太陽+月亮各一張,某一堆空了就只抽另一堆;日蝕獎勵抽2張則是自由選堆、抽兩次,每次抽牌時若太陽、月亮兩堆同時都空 → 判負。
7. 星星卡總數固定 18 張(雙方各 9 張)在雙方之間流動,贏家拿走的星星會計入自己該型別持有量,之後可能再被對方贏回去。
"""


def beats(a, b):
    return MATRIX[IDX[a]][IDX[b]]


class GameOver(Exception):
    def __init__(self, winner):
        self.winner = winner


class Player:
    def __init__(self, name):
        self.name = name
        self.stars = {"石頭": 3, "布": 3, "剪刀": 3}
        self.sun_pile = []
        self.moon_pile = []
        self.hand_sun = []
        self.hand_moon = []
        self.discard = []
        self.reset_round_state()

    def reset_round_state(self):
        self.committed_star = None
        self.played_sun_cards = []
        self.sun_negated = False
        self.moon_steal_active = None
        self.pending_moon_card = None
        self.moon_decided = False
        self.played_moon_card = None
        self.forced_moon = False


def new_shuffled(cards):
    deck = list(cards)
    random.shuffle(deck)
    return deck


class Game:
    def __init__(self, gui, difficulty="normal"):
        self.gui = gui
        self.difficulty = difficulty
        self.human = Player("你")
        self.ai = Player("電腦")
        for p in (self.human, self.ai):
            p.sun_pile = new_shuffled(SUN_CARDS_ALL)
            p.moon_pile = new_shuffled(MOON_CARDS_ALL)
        self.first_is_human = random.choice([True, False])
        self.round_num = 1
        self.stars_revealed = False
        self.human_star_history = Counter()
        self.gui.log(f"擲硬幣結果:{'你' if self.first_is_human else '電腦'} 先攻!")

    # -- 小工具 -------------------------------------------------------

    def project_final(self, p):
        if p.committed_star is None:
            return None
        piece = p.committed_star
        if p.played_sun_cards and not p.sun_negated:
            for sc in p.played_sun_cards:
                if sc in SUN_EVOLVE:
                    req, evo = SUN_EVOLVE[sc]
                    if req == p.committed_star:
                        piece = evo
        if p.moon_steal_active:
            piece = p.moon_steal_active
        return piece

    # -- 抽牌 ---------------------------------------------------------

    def mandatory_draw(self, player, opponent):
        if not player.sun_pile and not player.moon_pile:
            self.gui.log(f"{player.name} 太陽與月亮牌庫皆空,無法抽牌 —— 判負!")
            raise GameOver(winner=opponent)
        if player.sun_pile:
            c = player.sun_pile.pop()
            player.hand_sun.append(c)
            self.gui.log(f"{player.name} 從太陽牌庫抽牌。" + (f"(抽到:{c})" if player is self.human else ""))
        else:
            self.gui.log(f"{player.name} 太陽牌庫已空,略過太陽抽牌。")
        if player.moon_pile:
            c = player.moon_pile.pop()
            player.hand_moon.append(c)
            self.gui.log(f"{player.name} 從月亮牌庫抽牌。" + (f"(抽到:{c})" if player is self.human else ""))
        else:
            self.gui.log(f"{player.name} 月亮牌庫已空,略過月亮抽牌。")

    def tie_draw(self, player):
        has_sun = bool(player.sun_pile)
        has_moon = bool(player.moon_pile)
        if not has_sun and not has_moon:
            self.gui.log(f"{player.name} 太陽與月亮牌庫皆空,平手不強制抽牌。")
            return
        if has_sun and has_moon:
            if player is self.human:
                pile = self.gui.choose(
                    "平手抽牌(強制)",
                    f"{player.name},平手時牌庫仍有牌,必須抽一張,選擇要抽哪一堆:",
                    [(f"太陽牌庫(剩{len(player.sun_pile)})", "太陽"),
                     (f"月亮牌庫(剩{len(player.moon_pile)})", "月亮")],
                )
                if pile is None:
                    pile = "太陽"
            else:
                pile = random.choice(["太陽", "月亮"])
        else:
            pile = "太陽" if has_sun else "月亮"
            self.gui.log(f"{player.name} 只有{pile}牌庫還有牌,平手強制從該堆抽一張。")
        pile_list = player.sun_pile if pile == "太陽" else player.moon_pile
        hand = player.hand_sun if pile == "太陽" else player.hand_moon
        c = pile_list.pop()
        hand.append(c)
        self.gui.log(f"{player.name} 從{pile}牌庫抽了一張牌。" + (f"(抽到:{c})" if player is self.human else ""))

    def force_draw(self, target, opponent, pile_name):
        pile = target.sun_pile if pile_name == "太陽" else target.moon_pile
        other_pile = target.moon_pile if pile_name == "太陽" else target.sun_pile
        if not pile and not other_pile:
            self.gui.log(f"{target.name} 太陽與月亮牌庫皆空 —— 判負!")
            raise GameOver(winner=opponent)
        if not pile:
            self.gui.log(f"(指定的{pile_name}牌庫已空,無事發生)")
            return
        c = pile.pop()
        hand = target.hand_sun if pile_name == "太陽" else target.hand_moon
        hand.append(c)
        self.gui.log(f"{target.name} 被指定從{pile_name}牌庫抽牌。" + (f"(抽到:{c})" if target is self.human else ""))

    def free_draw_one(self, player, opponent):
        """抽一張牌,自由選太陽或月亮牌庫(某堆空就抽另一堆,兩堆都空則判負)。"""
        has_sun = bool(player.sun_pile)
        has_moon = bool(player.moon_pile)
        if not has_sun and not has_moon:
            self.gui.log(f"{player.name} 太陽與月亮牌庫皆空,無法抽牌 —— 判負!")
            raise GameOver(winner=opponent)
        if has_sun and has_moon:
            if player is self.human:
                pile = self.gui.choose(
                    "選擇要抽的牌堆",
                    f"{player.name},選擇要抽太陽還是月亮牌庫:",
                    [(f"太陽牌庫(剩{len(player.sun_pile)})", "太陽"),
                     (f"月亮牌庫(剩{len(player.moon_pile)})", "月亮")],
                )
                if pile is None:
                    pile = "太陽"
            else:
                pile = random.choice(["太陽", "月亮"])
        else:
            pile = "太陽" if has_sun else "月亮"
        pile_list = player.sun_pile if pile == "太陽" else player.moon_pile
        hand = player.hand_sun if pile == "太陽" else player.hand_moon
        c = pile_list.pop()
        hand.append(c)
        self.gui.log(f"{player.name} 從{pile}牌庫抽了一張牌。" + (f"(抽到:{c})" if player is self.human else ""))

    def eclipse_bonus_draw(self, defender, attacker):
        if defender is self.human:
            target = self.gui.choose(
                "日蝕反制獎勵",
                "成功反制烈陽!選擇由誰抽兩張牌(太陽、月亮牌庫自由選):",
                [(f"自己({defender.name})", defender), (f"對手({attacker.name})", attacker)],
            )
            if target is None:
                target = defender
        else:
            target = self.ai_decide_eclipse_bonus_target(defender, attacker)
        other = attacker if target is defender else defender
        self.gui.log(f"{defender.name} 選擇讓 {target.name} 抽兩張牌。")
        self.free_draw_one(target, other)
        self.free_draw_one(target, other)

    def ai_decide_eclipse_bonus_target(self, defender, attacker):
        attacker_total = len(attacker.sun_pile) + len(attacker.moon_pile)
        defender_total = len(defender.sun_pile) + len(defender.moon_pile)
        if attacker_total <= 2 and self.difficulty != "easy":
            return attacker
        if defender_total <= 2:
            return defender
        return random.choice([defender, attacker])

    # -- 星星階段(蓋牌,雙方同時決定) --------------------------------

    def pick_star(self, player):
        available = [t for t in STAR_TYPES if player.stars[t] > 0]
        if not available:
            return None
        if player is self.human:
            opts = [(f"{t}(剩{player.stars[t]}張)", t) for t in available]
            choice = self.gui.choose(
                "出星星卡(蓋牌)",
                "選擇這回合要出的星星卡(雙方同時決定,對方看不到):",
                opts,
            )
            return choice if choice is not None else available[0]
        return self.ai_choose_star(player, available)

    def ai_choose_star(self, ai_player, available):
        if self.difficulty == "easy" or sum(self.human_star_history.values()) == 0:
            return random.choice(available)
        noise = {"easy": 1.0, "normal": 0.25, "hard": 0.1}[self.difficulty]
        if random.random() < noise:
            return random.choice(available)
        most_common = self.human_star_history.most_common(1)[0][0]
        counter = {"石頭": "布", "布": "剪刀", "剪刀": "石頭"}[most_common]
        return counter if counter in available else random.choice(available)

    # -- 太陽階段 -------------------------------------------------------

    def sun_phase(self, actor, other):
        allowed_plays = 1
        plays_done = 0
        played_any = False
        while plays_done < allowed_plays:
            card = self.decide_sun_card(actor)
            if card is None:
                break
            played_any = True
            actor.hand_sun.remove(card)
            actor.played_sun_cards.append(card)
            plays_done += 1
            if card == "烈陽":
                bonus = self.resolve_blazing_sun(actor, other)
                if bonus:
                    allowed_plays += 1
            else:
                self.gui.log(f"{actor.name} 打出太陽卡:{card}")
        if not played_any:
            self.gui.log(f"{actor.name} 沒有打出太陽卡。")

    def decide_sun_card(self, actor):
        if actor is self.human:
            if not actor.hand_sun:
                return None
            opts = [(f"打出:{c}", c) for c in actor.hand_sun] + [("不出太陽", None)]
            return self.gui.choose("太陽階段", f"{actor.name},要打出太陽卡嗎?", opts)
        return self.ai_decide_sun(actor)

    def ai_decide_sun(self, actor):
        if not actor.hand_sun:
            return None
        matches = [c for c in actor.hand_sun if c in SUN_EVOLVE and SUN_EVOLVE[c][0] == actor.committed_star]
        if matches and (self.difficulty != "easy" or random.random() < 0.7):
            return matches[0]
        if "烈陽" in actor.hand_sun:
            chance = {"easy": 0.2, "normal": 0.4, "hard": 0.6}[self.difficulty]
            if random.random() < chance:
                return "烈陽"
        if self.difficulty == "easy" and random.random() < 0.3:
            return random.choice(actor.hand_sun)
        return None

    def resolve_blazing_sun(self, actor, other):
        self.gui.log(f"{actor.name} 打出【烈陽】!")
        if other.pending_moon_card == "日蝕":
            if self.decide_eclipse_counter(other, actor):
                other.hand_moon.remove("日蝕")
                other.discard.append("日蝕")
                other.pending_moon_card = None
                other.moon_decided = True
                self.gui.log(f"{other.name} 提前發動蓋著的【日蝕】反制!烈陽效果無效(烈陽直接進棄牌區)。")
                self.eclipse_bonus_draw(other, actor)
                return False
        effect = self.decide_blazing_effect(actor)
        if effect == 1:
            self.gui.log(f"{actor.name} 發動烈陽效果一:偷看 {other.name} 的星星出牌與手上月亮卡,並可追加一張太陽卡。")
            if actor is self.human:
                msg = (
                    f"{other.name} 這回合暗中出的星星:{other.committed_star or '(無)'}\n"
                    f"{other.name} 手上的月亮卡:{other.hand_moon if other.hand_moon else '(無)'}"
                )
                self.gui.info("烈陽偷看結果", msg)
            other.forced_moon = True
            self.gui.log(f"(規則:{other.name} 本回合月亮階段必須打出並發動一張月亮卡,不能選不出)")
            return True
        else:
            target, pile = self.decide_blazing_target(actor, other)
            self.gui.log(f"{actor.name} 發動烈陽效果二:指定 {target.name} 從{pile}牌庫抽一張。")
            self.force_draw(target, other if target is actor else actor, pile)
            return False

    def decide_eclipse_counter(self, defender, attacker):
        # 日蝕要先蓋牌才能發動(跟所有月亮卡一樣),反制烈陽時可以提前發動蓋著的日蝕
        if defender.pending_moon_card != "日蝕":
            return False
        if defender is self.human:
            return self.gui.confirm(
                "日蝕反制",
                f"{attacker.name} 打出了【烈陽】!你蓋著一張日蝕,是否提前發動來反制,使其效果無效?"
                f"\n(成功反制後,可再指定自己或對手抽兩張牌,太陽、月亮牌庫自由選;"
                f"這張日蝕會直接用掉,月亮階段就不會再有它了)",
            )
        chance = {"easy": 0.2, "normal": 0.5, "hard": 0.8}[self.difficulty]
        return random.random() < chance

    def decide_blazing_effect(self, actor):
        if actor is self.human:
            return self.gui.choose(
                "烈陽效果(擇一)",
                "選擇要發動的效果:",
                [("效果一:偷看對手星星/月亮,可追加一張太陽(對手本回合被迫出月亮)", 1),
                 ("效果二:指定自己或對手抽一張太陽/月亮卡", 2)],
            )
        return self.ai_decide_blazing_effect(actor)

    def ai_decide_blazing_effect(self, actor):
        other = self.human if actor is self.ai else self.ai
        other_total = len(other.sun_pile) + len(other.moon_pile)
        if other_total <= 2 and self.difficulty != "easy":
            return 2
        return random.choice([1, 2])

    def decide_blazing_target(self, actor, other):
        if actor is self.human:
            target = self.gui.choose(
                "烈陽效果二 — 目標", "指定誰抽牌?",
                [(f"對手({other.name})抽牌", other), (f"自己({actor.name})抽牌", actor)],
            )
            if target is None:
                target = other
            pile = self.gui.choose(
                "烈陽效果二 — 牌堆", "指定抽哪一堆?",
                [("太陽牌庫", "太陽"), ("月亮牌庫", "月亮")],
            )
            if pile is None:
                pile = "太陽"
            return target, pile
        return self.ai_decide_blazing_target(actor, other)

    def ai_decide_blazing_target(self, actor, other):
        actor_total = len(actor.sun_pile) + len(actor.moon_pile)
        if actor_total <= 1 and self.difficulty != "easy":
            return actor, random.choice(["太陽", "月亮"])
        return other, random.choice(["太陽", "月亮"])

    # -- 星星揭示 ---------------------------------------------------

    def star_reveal(self, p_first, p_second):
        self.gui.log(f"{p_first.name} 揭示星星:{p_first.committed_star or '(無星星可出)'}")
        self.gui.log(f"{p_second.name} 揭示星星:{p_second.committed_star or '(無星星可出)'}")
        self.stars_revealed = True

    # -- 月亮蓋牌(星星之後、太陽之前,雙方同時決定) ------------------

    def pick_moon_commit(self, player):
        if not player.hand_moon:
            return None
        if player is self.human:
            opts = [(f"蓋:{c}", c) for c in player.hand_moon] + [("不蓋月亮卡", None)]
            return self.gui.choose(
                "蓋月亮卡(可不蓋)",
                f"{player.name},要不要蓋一張月亮卡備用?(蓋牌後,稍後可以選擇要不要真的發動;\n"
                f"蓋出去的這張這回合就不能再用來反制烈陽了)",
                opts,
            )
        return self.ai_decide_moon_commit(player)

    def ai_decide_moon_commit(self, player):
        steal_cards = [c for c in player.hand_moon if c in MOON_STEAL]
        commit_chance = {"easy": 0.2, "normal": 0.5, "hard": 0.75}[self.difficulty]
        if steal_cards and random.random() < commit_chance:
            return random.choice(steal_cards)
        if "日蝕" in player.hand_moon:
            # 日蝕不蓋出去這回合就完全用不了(不管是反制烈陽還是主動使用),沒有留在手上的理由
            eclipse_commit_chance = {"easy": 0.5, "normal": 0.7, "hard": 0.85}[self.difficulty]
            if random.random() < eclipse_commit_chance:
                return "日蝕"
        return None

    # -- 月亮發動(星星揭示之後,決定要不要發動蓋著的那張) --------------

    def moon_activate(self, actor, other):
        if actor.moon_decided:
            self.gui.log(f"{actor.name} 蓋著的月亮卡已經在太陽階段用掉了。")
            return
        card = actor.pending_moon_card
        if card is None:
            actor.moon_decided = True
            self.gui.log(f"{actor.name} 沒有蓋月亮卡可發動。")
            return
        if actor.forced_moon:
            activate = True
            self.gui.log(f"{actor.name} 被烈陽效果一鎖定,必須發動蓋著的【{card}】!")
        elif actor is self.human:
            activate = self.gui.confirm(
                "發動月亮卡?",
                f"{actor.name},要發動蓋著的【{card}】嗎?(不發動的話,這張牌直接收回手上)",
            )
        else:
            activate = self.ai_decide_moon_activate(actor, other, card)
        actor.moon_decided = True
        if not activate:
            self.gui.log(f"{actor.name} 選擇不發動蓋著的月亮卡,收回手上。")
            return
        actor.hand_moon.remove(card)
        actor.played_moon_card = card
        actor.discard.append(card)
        if card == "日蝕":
            self.gui.log(f"{actor.name} 發動【日蝕】(效果二):使 {other.name} 的太陽卡效果無效。")
            other.sun_negated = True
        else:
            target_type = MOON_STEAL[card]
            if actor.committed_star is None:
                self.gui.log(f"{actor.name} 發動【{card}】,但本回合沒出星星卡,偷變無效。")
            else:
                self.gui.log(f"{actor.name} 發動【{card}】,把自己這回合的星星改成:{target_type}")
                actor.moon_steal_active = target_type

    def ai_decide_moon_activate(self, actor, other, card):
        other_proj = self.project_final(other)
        if card in MOON_STEAL:
            if not other_proj:
                return False  # 對手沒出招時,偷變沒有意義
            candidate = MOON_STEAL[card]
            candidate_score = beats(candidate, other_proj)
            current_proj = self.project_final(actor)
            current_score = beats(current_proj, other_proj) if current_proj else -2
            if self.difficulty == "hard":
                return candidate_score > current_score
            return candidate_score > current_score and candidate_score == 1
        if card == "日蝕":
            actor_proj = self.project_final(actor)
            if other.played_sun_cards and not other.sun_negated and other_proj and actor_proj:
                return beats(other_proj, actor_proj) == 1
            return False
        return True

    # -- 回合流程 -------------------------------------------------------

    def play_round(self):
        p_first, p_second = (self.human, self.ai) if self.first_is_human else (self.ai, self.human)

        for p in (self.human, self.ai):
            p.reset_round_state()
        self.stars_revealed = False

        self.gui.log(f"\n===== 第 {self.round_num} 回合 ===== (先攻:{p_first.name})")

        self.human.committed_star = self.pick_star(self.human)
        self.ai.committed_star = self.pick_star(self.ai)

        self.human.pending_moon_card = self.pick_moon_commit(self.human)
        self.ai.pending_moon_card = self.pick_moon_commit(self.ai)

        self.sun_phase(p_first, p_second)
        self.sun_phase(p_second, p_first)

        self.star_reveal(p_first, p_second)

        self.moon_activate(p_second, p_first)
        self.moon_activate(p_first, p_second)

        self.resolve(p_first, p_second)

        self.first_is_human = not self.first_is_human
        self.round_num += 1

    def resolve(self, p_first, p_second):
        fp1 = self.project_final(p_first)
        fp2 = self.project_final(p_second)
        self.gui.log(f"{p_first.name} 最終出招:{fp1 or '(無)'}　{p_second.name} 最終出招:{fp2 or '(無)'}")

        if self.human.committed_star is not None:
            self.human_star_history[self.human.committed_star] += 1

        for p in (p_first, p_second):
            for sc in p.played_sun_cards:
                if sc in SUN_EVOLVE and SUN_EVOLVE[sc][0] != p.committed_star:
                    p.hand_sun.append(sc)
                    self.gui.log(f"{p.name} 的【{sc}】星星型別不符,升級失敗,收回手牌。")
                else:
                    p.discard.append(sc)

        if fp1 is None and fp2 is None:
            self.gui.log("雙方都沒有星星可出,本回合視為平手。")
            outcome = 0
        elif fp1 is None:
            outcome = -1
        elif fp2 is None:
            outcome = 1
        else:
            outcome = beats(fp1, fp2)

        if outcome == 0:
            self.gui.log("平手!若太陽或月亮牌庫仍有牌則強制抽一張,牌庫皆空則不抽。")
            self.tie_draw(p_first)
            self.tie_draw(p_second)
        else:
            winner, loser = (p_first, p_second) if outcome == 1 else (p_second, p_first)
            self.gui.log(f"★ {winner.name} 贏得本回合!")
            if loser.committed_star:
                t = loser.committed_star
                loser.stars[t] -= 1
                winner.stars[t] += 1
                self.gui.log(f"{winner.name} 取走 {loser.name} 的一張『{t}』星星卡。({loser.name} {t} 剩 {loser.stars[t]})")
            self.gui.log(f"{loser.name} 判負,需抽牌:太陽牌庫 1 張、月亮牌庫 1 張。")
            self.mandatory_draw(loser, winner)
