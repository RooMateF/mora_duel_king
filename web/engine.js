// 猜☆拳☆王 — 遊戲引擎(對應 rps_core.py)
// 雙人連線模式:只在「房主」的瀏覽器執行,房主 = p1,加入者 = p2。
// 單人模式:new Game(ui, "你", "電腦", {vsAi:true, difficulty}) 時,p2 全部由內建 AI 決策,完全不會呼叫 ui。
// this.ui 需提供以下介面(見 net.js / app.js 的 makeUi()):
//   ui.log(text)
//   ui.ask(role, title, prompt, options, kind, onResolved) -> Promise<value>   options: [{label, value}]
//     kind 是可選的提示,標記這個詢問對應到「打出哪張牌」,讓 UI 可以直接點卡片而不是跳文字選單:
//     "star" | "sun" | "moonCommit" | "moonActivate" | "drawPile" | undefined(一般文字選項)
//     onResolved(value) 是可選的同步 callback,在 UI 內部重新畫面之前執行——用來讓引擎把這次選擇的結果
//     先寫回 player 物件,避免「畫面先渲染、引擎才把狀態寫回去」的順序問題導致畫面顯示舊狀態。
//   ui.confirm(role, title, prompt) -> Promise<boolean>
//   ui.info(role, title, msg) -> Promise<void>

class GameOverError extends Error {
  constructor(winnerRole) {
    super("GameOver");
    this.winnerRole = winnerRole;
  }
}

class Player {
  constructor(role, name) {
    this.role = role;
    this.name = name;
    this.stars = { "石頭": 3, "布": 3, "剪刀": 3 };
    this.sunPile = [];
    this.moonPile = [];
    this.handSun = [];
    this.handMoon = [];
    this.discard = [];
    this.resetRoundState();
  }

  resetRoundState() {
    this.committedStar = null;
    this.playedSunCards = [];
    this.sunNegated = false;
    this.moonStealActive = null;
    this.pendingMoonCard = null;
    this.moonDecided = false;
    this.playedMoonCard = null;
    this.forcedMoon = false;
  }
}

class Game {
  constructor(ui, p1Name, p2Name, opts = {}) {
    this.ui = ui;
    this.p1 = new Player("p1", p1Name);
    this.p2 = new Player("p2", p2Name);
    for (const p of [this.p1, this.p2]) {
      p.sunPile = newShuffled(SUN_CARDS_ALL);
      p.moonPile = newShuffled(MOON_CARDS_ALL);
    }
    this.firstIsP1 = Math.random() < 0.5;
    this.roundNum = 1;
    this.starsRevealed = false;
    this.vsAi = !!opts.vsAi; // true 時 p2 由電腦自動決策(單人模式)
    this.difficulty = opts.difficulty || "normal";
    this.humanStarHistory = {};
  }

  other(p) {
    return p === this.p1 ? this.p2 : this.p1;
  }

  byRole(role) {
    return role === "p1" ? this.p1 : this.p2;
  }

  isAiControlled(player) {
    return this.vsAi && player === this.p2;
  }

  projectFinal(p) {
    if (p.committedStar === null) return null;
    let piece = p.committedStar;
    if (p.playedSunCards.length && !p.sunNegated) {
      for (const sc of p.playedSunCards) {
        if (SUN_EVOLVE[sc]) {
          const [req, evo] = SUN_EVOLVE[sc];
          if (req === p.committedStar) piece = evo;
        }
      }
    }
    if (p.moonStealActive) piece = p.moonStealActive;
    return piece;
  }

  // -- 抽牌 ---------------------------------------------------------

  async mandatoryDraw(player, opponent) {
    if (!player.sunPile.length && !player.moonPile.length) {
      await this.ui.log(`${player.name} 太陽與月亮牌庫皆空,無法抽牌 —— 判負!`);
      throw new GameOverError(opponent.role);
    }
    if (player.sunPile.length) {
      player.handSun.push(player.sunPile.pop());
      await this.ui.log(`${player.name} 從太陽牌庫抽牌。`);
    } else {
      await this.ui.log(`${player.name} 太陽牌庫已空,略過太陽抽牌。`);
    }
    if (player.moonPile.length) {
      player.handMoon.push(player.moonPile.pop());
      await this.ui.log(`${player.name} 從月亮牌庫抽牌。`);
    } else {
      await this.ui.log(`${player.name} 月亮牌庫已空,略過月亮抽牌。`);
    }
  }

  async tieDraw(player) {
    const hasSun = player.sunPile.length > 0;
    const hasMoon = player.moonPile.length > 0;
    if (!hasSun && !hasMoon) {
      await this.ui.log(`${player.name} 太陽與月亮牌庫皆空,平手不強制抽牌。`);
      return;
    }
    let pile;
    if (hasSun && hasMoon) {
      if (this.isAiControlled(player)) {
        pile = Math.random() < 0.5 ? "太陽" : "月亮";
      } else {
        pile = await this.ui.ask(player.role, "平手抽牌(強制)",
          "平手,選擇要抽的牌堆",
          [
            { label: `太陽牌庫(剩${player.sunPile.length})`, value: "太陽" },
            { label: `月亮牌庫(剩${player.moonPile.length})`, value: "月亮" },
          ], "drawPile");
        if (!pile) pile = "太陽";
      }
    } else {
      pile = hasSun ? "太陽" : "月亮";
      await this.ui.log(`${player.name} 只有${pile}牌庫還有牌,平手強制從該堆抽一張。`);
    }
    const pileList = pile === "太陽" ? player.sunPile : player.moonPile;
    const hand = pile === "太陽" ? player.handSun : player.handMoon;
    hand.push(pileList.pop());
    await this.ui.log(`${player.name} 從${pile}牌庫抽了一張牌。`);
  }

  async forceDraw(target, opponent, pileName) {
    const pile = pileName === "太陽" ? target.sunPile : target.moonPile;
    const otherPile = pileName === "太陽" ? target.moonPile : target.sunPile;
    if (!pile.length && !otherPile.length) {
      await this.ui.log(`${target.name} 太陽與月亮牌庫皆空 —— 判負!`);
      throw new GameOverError(opponent.role);
    }
    if (!pile.length) {
      await this.ui.log(`(指定的${pileName}牌庫已空,無事發生)`);
      return;
    }
    const hand = pileName === "太陽" ? target.handSun : target.handMoon;
    hand.push(pile.pop());
    await this.ui.log(`${target.name} 被指定從${pileName}牌庫抽牌。`);
  }

  async freeDrawOne(player, opponent) {
    const hasSun = player.sunPile.length > 0;
    const hasMoon = player.moonPile.length > 0;
    if (!hasSun && !hasMoon) {
      await this.ui.log(`${player.name} 太陽與月亮牌庫皆空,無法抽牌 —— 判負!`);
      throw new GameOverError(opponent.role);
    }
    let pile;
    if (hasSun && hasMoon) {
      if (this.isAiControlled(player)) {
        pile = Math.random() < 0.5 ? "太陽" : "月亮";
      } else {
        pile = await this.ui.ask(player.role, "選擇要抽的牌堆",
          "選擇要抽的牌堆",
          [
            { label: `太陽牌庫(剩${player.sunPile.length})`, value: "太陽" },
            { label: `月亮牌庫(剩${player.moonPile.length})`, value: "月亮" },
          ], "drawPile");
        if (!pile) pile = "太陽";
      }
    } else {
      pile = hasSun ? "太陽" : "月亮";
    }
    const pileList = pile === "太陽" ? player.sunPile : player.moonPile;
    const hand = pile === "太陽" ? player.handSun : player.handMoon;
    hand.push(pileList.pop());
    await this.ui.log(`${player.name} 從${pile}牌庫抽了一張牌。`);
  }

  async eclipseBonusDraw(defender, attacker) {
    let target;
    if (this.isAiControlled(defender)) {
      target = this.aiDecideEclipseBonusTarget(defender, attacker);
    } else {
      const targetRole = await this.ui.ask(defender.role, "日蝕反制獎勵",
        "反制成功!選擇由誰抽兩張牌",
        [
          { label: `自己(${defender.name})`, value: defender.role },
          { label: `對手(${attacker.name})`, value: attacker.role },
        ]);
      target = this.byRole(targetRole || defender.role);
    }
    const otherP = this.other(target);
    await this.ui.log(`${defender.name} 選擇讓 ${target.name} 抽兩張牌。`);
    await this.freeDrawOne(target, otherP);
    await this.freeDrawOne(target, otherP);
  }

  aiDecideEclipseBonusTarget(defender, attacker) {
    const attackerTotal = attacker.sunPile.length + attacker.moonPile.length;
    const defenderTotal = defender.sunPile.length + defender.moonPile.length;
    if (attackerTotal <= 2 && this.difficulty !== "easy") return attacker;
    if (defenderTotal <= 2) return defender;
    return Math.random() < 0.5 ? defender : attacker;
  }

  // -- 星星階段(蓋牌,雙方同時決定) --------------------------------

  async pickStar(player) {
    const available = STAR_TYPES.filter((t) => player.stars[t] > 0);
    if (!available.length) return null;
    if (this.isAiControlled(player)) return this.aiChooseStar(player, available);
    const choice = await this.ui.ask(player.role, "出星星卡(蓋牌)",
      "選擇這回合的星星牌(對方看不到)",
      available.map((t) => ({ label: `${t}(剩${player.stars[t]}張)`, value: t })), "star",
      (v) => { player.committedStar = v || available[0]; });
    return choice || available[0];
  }

  aiChooseStar(aiPlayer, available) {
    const totalHistory = Object.values(this.humanStarHistory).reduce((a, b) => a + b, 0);
    if (this.difficulty === "easy" || totalHistory === 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
    const noise = { easy: 1.0, normal: 0.25, hard: 0.1 }[this.difficulty];
    if (Math.random() < noise) return available[Math.floor(Math.random() * available.length)];
    let mostCommon = STAR_TYPES[0], mostCount = -1;
    for (const t of STAR_TYPES) {
      const c = this.humanStarHistory[t] || 0;
      if (c > mostCount) { mostCount = c; mostCommon = t; }
    }
    const counter = { "石頭": "布", "布": "剪刀", "剪刀": "石頭" }[mostCommon];
    return available.includes(counter) ? counter : available[Math.floor(Math.random() * available.length)];
  }

  // -- 太陽階段 -------------------------------------------------------

  async sunPhase(actor, other) {
    const card = await this.decideSunCard(actor);
    if (card) {
      actor.handSun.splice(actor.handSun.indexOf(card), 1);
      actor.playedSunCards.push(card);
      if (card === "烈陽") {
        await this.resolveBlazingSun(actor, other);
      } else {
        await this.ui.log(`${actor.name} 打出太陽卡:${card}`);
      }
    } else {
      await this.ui.log(`${actor.name} 沒有打出太陽卡。`);
    }
  }

  async decideSunCard(actor) {
    if (!actor.handSun.length) return null;
    if (this.isAiControlled(actor)) return this.aiDecideSun(actor);
    const opts = actor.handSun.map((c) => ({ label: `打出:${c}`, value: c }));
    opts.push({ label: "不出太陽", value: null });
    return await this.ui.ask(actor.role, "太陽階段", "是否打出太陽牌?", opts, "sun");
  }

  aiDecideSun(actor) {
    const matches = actor.handSun.filter((c) => SUN_EVOLVE[c] && SUN_EVOLVE[c][0] === actor.committedStar);
    if (matches.length && (this.difficulty !== "easy" || Math.random() < 0.7)) return matches[0];
    if (actor.handSun.includes("烈陽")) {
      const chance = { easy: 0.2, normal: 0.4, hard: 0.6 }[this.difficulty];
      if (Math.random() < chance) return "烈陽";
    }
    if (this.difficulty === "easy" && Math.random() < 0.3) {
      return actor.handSun[Math.floor(Math.random() * actor.handSun.length)];
    }
    return null;
  }

  async resolveBlazingSun(actor, other) {
    await this.ui.log(`${actor.name} 打出【烈陽】!`);
    if (other.pendingMoonCard === "日蝕") {
      const countered = await this.decideEclipseCounter(other, actor);
      if (countered) {
        other.handMoon.splice(other.handMoon.indexOf("日蝕"), 1);
        other.discard.push("日蝕");
        other.pendingMoonCard = null;
        other.moonDecided = true;
        await this.ui.log(`${other.name} 提前發動蓋著的【日蝕】反制!烈陽效果無效(烈陽直接進棄牌區)。`);
        await this.eclipseBonusDraw(other, actor);
        return;
      }
    }
    const effect = this.isAiControlled(actor)
      ? this.aiDecideBlazingEffect(actor, other)
      : await this.ui.ask(actor.role, "烈陽效果(擇一)", "選擇要發動的效果:", [
        { label: "效果一:指定自己或對手,從太陽或月亮牌庫抽一張牌", value: 1 },
        { label: "效果二:偷看對手星星與蓋著的月亮卡,可選擇強制發動或強制丟棄那張月亮卡", value: 2 },
      ]);
    if (effect === 1) {
      let target, pile;
      if (this.isAiControlled(actor)) {
        ({ target, pile } = this.aiDecideBlazingTarget(actor, other));
      } else {
        const targetRole = await this.ui.ask(actor.role, "烈陽效果一 — 目標", "指定誰抽牌?", [
          { label: `對手(${other.name})抽牌`, value: other.role },
          { label: `自己(${actor.name})抽牌`, value: actor.role },
        ]);
        target = this.byRole(targetRole || other.role);
        pile = await this.ui.ask(actor.role, "烈陽效果一 — 牌堆", "指定抽哪一堆?", [
          { label: "太陽牌庫", value: "太陽" },
          { label: "月亮牌庫", value: "月亮" },
        ]) || "太陽";
      }
      await this.ui.log(`${actor.name} 發動烈陽效果一:指定 ${target.name} 從${pile}牌庫抽一張。`);
      await this.forceDraw(target, target === actor ? other : actor, pile);
    } else {
      await this.ui.log(`${actor.name} 發動烈陽效果二:偷看 ${other.name} 的星星與蓋著的月亮卡。`);
      const pending = other.pendingMoonCard;
      if (!this.isAiControlled(actor)) {
        const msg = `${other.name} 這回合暗中出的星星:${other.committedStar || "(無)"}\n` +
          `${other.name} 蓋著的月亮卡:${pending || "(無)"}`;
        await this.ui.info(actor.role, "烈陽偷看結果", msg);
      }
      if (!pending) {
        await this.ui.log(`${other.name} 沒有蓋月亮卡,無牌可以強制。`);
        return;
      }
      const choice = this.isAiControlled(actor)
        ? this.aiDecideBlazingForcedChoice(actor, other)
        : await this.ui.ask(actor.role, "烈陽效果二 — 強制發動或丟棄",
          `${other.name} 蓋著【${pending}】,要強制發動還是強制丟棄?`, [
            { label: "強制發動(月亮階段強制生效)", value: "activate" },
            { label: "強制丟棄(直接作廢)", value: "discard" },
          ]) || "discard";
      if (choice === "discard") {
        other.handMoon.splice(other.handMoon.indexOf(pending), 1);
        other.discard.push(pending);
        other.pendingMoonCard = null;
        other.moonDecided = true;
        await this.ui.log(`${actor.name} 強制丟棄 ${other.name} 蓋著的【${pending}】!`);
      } else {
        other.forcedMoon = true;
        await this.ui.log(`${actor.name} 強制發動 ${other.name} 蓋著的【${pending}】!(月亮階段會強制生效)`);
      }
    }
  }

  aiDecideBlazingEffect(actor, other) {
    const otherTotal = other.sunPile.length + other.moonPile.length;
    if (otherTotal <= 2 && this.difficulty !== "easy") return 1;
    return Math.random() < 0.5 ? 1 : 2;
  }

  aiDecideBlazingForcedChoice(actor, other) {
    // 強制丟棄通常比較安全:不會意外幫到對方,也不會反過來打掉自己剛升級的太陽卡
    const chanceDiscard = { easy: 0.5, normal: 0.75, hard: 0.9 }[this.difficulty];
    return Math.random() < chanceDiscard ? "discard" : "activate";
  }

  aiDecideBlazingTarget(actor, other) {
    const actorTotal = actor.sunPile.length + actor.moonPile.length;
    const pile = Math.random() < 0.5 ? "太陽" : "月亮";
    if (actorTotal <= 1 && this.difficulty !== "easy") return { target: actor, pile };
    return { target: other, pile };
  }

  async decideEclipseCounter(defender, attacker) {
    // 日蝕要先蓋牌才能發動(跟所有月亮卡一樣),反制烈陽時可以提前發動蓋著的日蝕
    if (defender.pendingMoonCard !== "日蝕") return false;
    if (this.isAiControlled(defender)) {
      // 反制幾乎穩賺:烈陽直接無效+還能抽兩張牌,不反制的話對手很可能直接用效果二把這張日蝕強制丟棄、什麼都拿不到
      const chance = { easy: 0.35, normal: 0.85, hard: 1 }[this.difficulty];
      return Math.random() < chance;
    }
    return await this.ui.confirm(defender.role, "日蝕反制",
      `${attacker.name} 打出了【烈陽】!是否發動日蝕反制?`);
  }

  // -- 星星揭示 ---------------------------------------------------

  async starReveal(pFirst, pSecond) {
    // 這個 flag 要在任何一句 log 觸發重畫之前就設好,不然畫面會在整個揭示階段都還顯示蓋牌
    this.starsRevealed = true;
    await this.ui.log(`${pFirst.name} 揭示星星:${pFirst.committedStar || "(無星星可出)"}`);
    await this.ui.log(`${pSecond.name} 揭示星星:${pSecond.committedStar || "(無星星可出)"}`);
  }

  // -- 月亮蓋牌(星星之後、太陽之前,雙方同時決定) ------------------

  async pickMoonCommit(player) {
    if (!player.handMoon.length) return null;
    if (this.isAiControlled(player)) return this.aiDecideMoonCommit(player);
    const opts = player.handMoon.map((c) => ({ label: `蓋:${c}`, value: c }));
    opts.push({ label: "不蓋月亮卡", value: null });
    return await this.ui.ask(player.role, "蓋月亮卡(可不蓋)",
      "是否蓋下月亮牌?", opts, "moonCommit",
      (v) => { player.pendingMoonCard = v; });
  }

  aiDecideMoonCommit(player) {
    const stealCards = player.handMoon.filter((c) => MOON_STEAL[c]);
    const commitChance = { easy: 0.2, normal: 0.5, hard: 0.75 }[this.difficulty];
    if (stealCards.length && Math.random() < commitChance) {
      return stealCards[Math.floor(Math.random() * stealCards.length)];
    }
    if (player.handMoon.includes("日蝕")) {
      // 日蝕不蓋出去這回合就完全用不了(不管是反制烈陽還是主動使用),沒有留在手上的理由
      const eclipseCommitChance = { easy: 0.5, normal: 0.7, hard: 0.85 }[this.difficulty];
      if (Math.random() < eclipseCommitChance) return "日蝕";
    }
    return null;
  }

  // -- 月亮發動(星星揭示之後,決定要不要發動蓋著的那張) --------------

  // 把「發動與否」決定後要做的所有狀態異動都集中在這裡,並且一定要在畫面重畫之前執行完(見 ui.ask 的
  // onResolved 說明),否則畫面會先用舊狀態畫一次,月亮卡看起來像沒蓋一樣。
  applyMoonActivation(actor, other, card, activate) {
    actor.moonDecided = true;
    if (!activate) return;
    actor.handMoon.splice(actor.handMoon.indexOf(card), 1);
    actor.playedMoonCard = card;
    actor.discard.push(card);
    if (card === "日蝕") {
      other.sunNegated = true;
    } else if (actor.committedStar !== null) {
      actor.moonStealActive = MOON_STEAL[card];
    }
  }

  async moonActivate(actor, other) {
    if (actor.moonDecided) {
      await this.ui.log(`${actor.name} 蓋著的月亮卡已經在太陽階段用掉了。`);
      return;
    }
    const card = actor.pendingMoonCard;
    if (!card) {
      actor.moonDecided = true;
      await this.ui.log(`${actor.name} 沒有蓋月亮卡可發動。`);
      return;
    }
    let activate;
    if (actor.forcedMoon) {
      activate = true;
      this.applyMoonActivation(actor, other, card, true);
      await this.ui.log(`${actor.name} 被烈陽效果一鎖定,必須發動蓋著的【${card}】!`);
    } else if (this.isAiControlled(actor)) {
      activate = this.aiDecideMoonActivate(actor, other, card);
      this.applyMoonActivation(actor, other, card, activate);
    } else {
      activate = await this.ui.ask(actor.role, "發動月亮卡?",
        `是否發動【${card}】?`,
        [{ label: `發動【${card}】`, value: true }, { label: "不發動", value: false }],
        "moonActivate",
        (v) => this.applyMoonActivation(actor, other, card, v));
    }
    if (!activate) {
      await this.ui.log(`${actor.name} 選擇不發動蓋著的月亮卡,收回手上。`);
      return;
    }
    if (card === "日蝕") {
      await this.ui.log(`${actor.name} 發動【日蝕】(效果二):使 ${other.name} 的太陽卡效果無效。`);
    } else {
      const targetType = MOON_STEAL[card];
      if (actor.committedStar === null) {
        await this.ui.log(`${actor.name} 發動【${card}】,但本回合沒出星星卡,偷變無效。`);
      } else {
        await this.ui.log(`${actor.name} 發動【${card}】,把自己這回合的星星改成:${targetType}`);
      }
    }
  }

  aiDecideMoonActivate(actor, other, card) {
    const otherProj = this.projectFinal(other);
    if (MOON_STEAL[card]) {
      if (!otherProj) return false; // 對手沒出招時,偷變沒有意義
      const candidate = MOON_STEAL[card];
      const candidateScore = beats(candidate, otherProj);
      const currentProj = this.projectFinal(actor);
      const currentScore = currentProj ? beats(currentProj, otherProj) : -2;
      if (this.difficulty === "hard") return candidateScore > currentScore;
      return candidateScore > currentScore && candidateScore === 1;
    }
    if (card === "日蝕") {
      const actorProj = this.projectFinal(actor);
      if (other.playedSunCards.length && !other.sunNegated && otherProj && actorProj) {
        return beats(otherProj, actorProj) === 1;
      }
      return false;
    }
    return true;
  }

  // -- 回合流程 -------------------------------------------------------

  async playRound() {
    const pFirst = this.firstIsP1 ? this.p1 : this.p2;
    const pSecond = this.firstIsP1 ? this.p2 : this.p1;

    this.p1.resetRoundState();
    this.p2.resetRoundState();
    this.starsRevealed = false;

    await this.ui.log(`\n===== 第 ${this.roundNum} 回合 ===== (先攻:${pFirst.name})`);

    this.p1.committedStar = await this.pickStar(this.p1);
    this.p2.committedStar = await this.pickStar(this.p2);

    this.p1.pendingMoonCard = await this.pickMoonCommit(this.p1);
    this.p2.pendingMoonCard = await this.pickMoonCommit(this.p2);

    await this.sunPhase(pFirst, pSecond);
    await this.sunPhase(pSecond, pFirst);

    await this.starReveal(pFirst, pSecond);

    await this.moonActivate(pSecond, pFirst);
    await this.moonActivate(pFirst, pSecond);

    await this.resolve(pFirst, pSecond);

    this.firstIsP1 = !this.firstIsP1;
    this.roundNum += 1;
  }

  async resolve(pFirst, pSecond) {
    const fp1 = this.projectFinal(pFirst);
    const fp2 = this.projectFinal(pSecond);
    await this.ui.log(`${pFirst.name} 最終出招:${fp1 || "(無)"}　${pSecond.name} 最終出招:${fp2 || "(無)"}`);

    if (this.vsAi && this.p1.committedStar !== null) {
      this.humanStarHistory[this.p1.committedStar] = (this.humanStarHistory[this.p1.committedStar] || 0) + 1;
    }

    for (const p of [pFirst, pSecond]) {
      for (const sc of p.playedSunCards) {
        if (SUN_EVOLVE[sc] && SUN_EVOLVE[sc][0] !== p.committedStar) {
          p.handSun.push(sc);
          await this.ui.log(`${p.name} 的【${sc}】星星型別不符,升級失敗,收回手牌。`);
        } else {
          p.discard.push(sc);
        }
      }
    }

    let outcome;
    if (fp1 === null && fp2 === null) {
      await this.ui.log("雙方都沒有星星可出,本回合視為平手。");
      outcome = 0;
    } else if (fp1 === null) {
      outcome = -1;
    } else if (fp2 === null) {
      outcome = 1;
    } else {
      outcome = beats(fp1, fp2);
    }

    if (outcome === 0) {
      await this.ui.log("平手!若太陽或月亮牌庫仍有牌則強制抽一張,牌庫皆空則不抽。");
      await this.tieDraw(pFirst);
      await this.tieDraw(pSecond);
    } else {
      const [winner, loser] = outcome === 1 ? [pFirst, pSecond] : [pSecond, pFirst];
      await this.ui.log(`★ ${winner.name} 贏得本回合!`);
      if (loser.committedStar) {
        const t = loser.committedStar;
        loser.stars[t] -= 1;
        winner.stars[t] += 1;
        await this.ui.log(`${winner.name} 取走 ${loser.name} 的一張『${t}』星星卡。(${loser.name} ${t} 剩 ${loser.stars[t]})`);
      }
      await this.ui.log(`${loser.name} 判負,需抽牌:太陽牌庫 1 張、月亮牌庫 1 張。`);
      await this.mandatoryDraw(loser, winner);
    }
  }
}
