// 猜拳卡牌遊戲 — 網頁版主程式(大廳、房間、渲染、房主端遊戲迴圈)

let myUid = null;
let roomCode = null;
let isHost = false;
let myRole = null; // "p1" | "p2"
let game = null; // 只有房主會建立
let hostStarted = false;
let gameLog = [];
let lastPublicSeen = null;
let lastPrivateSeen = null;

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  ["lobby", "waiting", "gameScreen"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

async function init() {
  Net.init();
  try {
    myUid = await Net.signIn();
  } catch (e) {
    $("lobbyMsg").textContent = "Firebase 尚未設定好,請先完成 README 的設定步驟。(" + e.message + ")";
    return;
  }
  $("createBtn").onclick = onCreate;
  $("joinBtn").onclick = onJoin;
  document.querySelectorAll(".diffBtn").forEach((btn) => {
    btn.onclick = () => startSinglePlayer(btn.dataset.diff);
  });
  $("rulesBtn").onclick = showRules;
  $("rulesCloseBtn").onclick = () => $("rulesOverlay").classList.add("hidden");
  $("copyCodeBtn").onclick = () => {
    navigator.clipboard.writeText(roomCode);
    $("copyCodeBtn").textContent = "已複製!";
    setTimeout(() => { $("copyCodeBtn").textContent = "複製代碼"; }, 1500);
  };
}

async function onCreate() {
  const name = ($("nameInput").value || "").trim() || "玩家";
  $("lobbyMsg").textContent = "";
  try {
    roomCode = await Net.createRoom(name);
  } catch (e) {
    $("lobbyMsg").textContent = e.message;
    return;
  }
  isHost = true;
  myRole = "p1";
  $("roomCodeDisplay").textContent = roomCode;
  showScreen("waiting");
  Net.watchMeta(roomCode, onRoomUpdateAsHost);
}

async function onJoin() {
  const name = ($("nameInput").value || "").trim() || "玩家";
  const code = ($("codeInput").value || "").trim().toUpperCase();
  $("lobbyMsg").textContent = "";
  if (!code) {
    $("lobbyMsg").textContent = "請輸入房間代碼";
    return;
  }
  try {
    await Net.joinRoom(code, name);
  } catch (e) {
    $("lobbyMsg").textContent = e.message;
    return;
  }
  roomCode = code;
  isHost = false;
  myRole = "p2";
  startGuest();
}

function onRoomUpdateAsHost(room) {
  if (!room) return;
  if (room.guestUid && !hostStarted) {
    hostStarted = true;
    startHostGame(room.hostName, room.guestName, room.guestUid);
  }
}

function startGuest() {
  showScreen("gameScreen");
  Net.watchPublic(roomCode, (pub) => {
    if (pub) renderPublic(pub);
  });
  Net.watchPrivate(roomCode, myUid, (priv) => {
    lastPrivateSeen = priv;
    if (lastPublicSeen) renderPublic(lastPublicSeen);
  });
  Net.listenRpcRequest(roomCode, myUid, async (req) => {
    const value = await showLocalModal(req.title, req.prompt, req.options);
    await Net.sendRpcResponse(roomCode, myUid, req.id, value);
  });
}

function startHostGame(hostName, guestName, guestUid) {
  showScreen("gameScreen");
  const ui = makeUi(guestUid);
  game = new Game(ui, hostName, guestName);

  Net.watchPublic(roomCode, (pub) => {
    if (pub) renderPublic(pub);
  });
  Net.watchPrivate(roomCode, myUid, (priv) => {
    lastPrivateSeen = priv;
    if (lastPublicSeen) renderPublic(lastPublicSeen);
  });
  Net.listenRpcRequest(roomCode, myUid, async (req) => {
    const value = await showLocalModal(req.title, req.prompt, req.options);
    await Net.sendRpcResponse(roomCode, myUid, req.id, value);
  });

  runGameLoop(guestUid);
}

function makeUi(guestUid) {
  async function ask(role, title, prompt, options) {
    let value;
    if (role === "p1") {
      value = await showLocalModal(title, prompt, options);
    } else {
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Math.random());
      await Net.sendRpcRequest(roomCode, guestUid, {
        id, title, prompt,
        options: options.map((o) => ({ label: o.label, value: (o.value === undefined ? null : o.value) })),
      });
      value = await Net.waitRpcResponse(roomCode, guestUid, id);
    }
    await publishState(guestUid);
    return value;
  }
  async function log(text) {
    gameLog.push(text);
    if (gameLog.length > 300) gameLog = gameLog.slice(-300);
    await publishState(guestUid);
  }
  async function confirm(role, title, prompt) {
    const v = await ask(role, title, prompt, [
      { label: "是", value: true },
      { label: "否", value: false },
    ]);
    return !!v;
  }
  async function info(role, title, msg) {
    await ask(role, title, msg, [{ label: "知道了", value: true }]);
  }
  return { log, ask, confirm, info };
}

function boardSnapshotFor(p, revealStar) {
  return {
    name: p.name,
    stars: { ...p.stars },
    sunPileCount: p.sunPile.length,
    moonPileCount: p.moonPile.length,
    handSunCount: p.handSun.length,
    handMoonCount: p.handMoon.length,
    discardCount: p.discard.length,
    playedSun: p.playedSunCards.slice(),
    star: revealStar ? p.committedStar : null,
    playedMoon: p.moonDecided ? p.playedMoonCard : null,
    moonPending: !p.moonDecided && p.pendingMoonCard !== null,
  };
}

async function publishState(guestUid) {
  const pub = {
    round: game.roundNum,
    starsRevealed: game.starsRevealed,
    p1: boardSnapshotFor(game.p1, game.starsRevealed),
    p2: boardSnapshotFor(game.p2, game.starsRevealed),
    log: gameLog,
    winnerRole: null,
    updatedAt: Date.now(),
  };
  await Net.publishPublic(roomCode, pub);
  await Net.publishPrivate(roomCode, myUid, {
    handSun: game.p1.handSun, handMoon: game.p1.handMoon, committedStar: game.p1.committedStar,
    pendingMoonCard: game.p1.pendingMoonCard,
  });
  await Net.publishPrivate(roomCode, guestUid, {
    handSun: game.p2.handSun, handMoon: game.p2.handMoon, committedStar: game.p2.committedStar,
    pendingMoonCard: game.p2.pendingMoonCard,
  });
}

async function runGameLoop(guestUid) {
  try {
    while (true) {
      await game.playRound();
    }
  } catch (e) {
    if (e instanceof GameOverError) {
      gameLog.push(`\n★★★ 遊戲結束!獲勝者:${e.winnerRole === "p1" ? game.p1.name : game.p2.name} ★★★`);
      const pub = {
        round: game.roundNum,
        starsRevealed: true,
        p1: boardSnapshotFor(game.p1, true),
        p2: boardSnapshotFor(game.p2, true),
        log: gameLog,
        winnerRole: e.winnerRole,
        updatedAt: Date.now(),
      };
      await Net.publishPublic(roomCode, pub);
    } else {
      console.error(e);
      gameLog.push(`發生錯誤:${e.message}`);
      await publishState(guestUid);
    }
  }
}

// -- 單人對戰 AI(完全本機執行,不用 Firebase)-----------------------

function startSinglePlayer(difficulty) {
  isHost = true;
  myRole = "p1";
  roomCode = null;
  gameLog = [];
  window.__gameOverShown = false;
  showScreen("gameScreen");

  const ui = makeLocalUi();
  game = new Game(ui, "你", "電腦", { vsAi: true, difficulty });
  renderLocalState();
  runLocalGameLoop();
}

function makeLocalUi() {
  async function ask(_role, title, prompt, options) {
    const value = await showLocalModal(title, prompt, options);
    renderLocalState();
    return value;
  }
  async function log(text) {
    gameLog.push(text);
    if (gameLog.length > 300) gameLog = gameLog.slice(-300);
    renderLocalState();
  }
  async function confirm(role, title, prompt) {
    const v = await ask(role, title, prompt, [
      { label: "是", value: true },
      { label: "否", value: false },
    ]);
    return !!v;
  }
  async function info(role, title, msg) {
    await ask(role, title, msg, [{ label: "知道了", value: true }]);
  }
  return { log, ask, confirm, info };
}

function renderLocalState(winnerRole) {
  const pub = {
    round: game.roundNum,
    starsRevealed: game.starsRevealed,
    p1: boardSnapshotFor(game.p1, game.starsRevealed || !!winnerRole),
    p2: boardSnapshotFor(game.p2, game.starsRevealed || !!winnerRole),
    log: gameLog,
    winnerRole: winnerRole || null,
  };
  lastPrivateSeen = {
    handSun: game.p1.handSun, handMoon: game.p1.handMoon, committedStar: game.p1.committedStar,
    pendingMoonCard: game.p1.pendingMoonCard,
  };
  renderPublic(pub);
}

async function runLocalGameLoop() {
  try {
    while (true) {
      await game.playRound();
    }
  } catch (e) {
    if (e instanceof GameOverError) {
      gameLog.push(`\n★★★ 遊戲結束!獲勝者:${e.winnerRole === "p1" ? game.p1.name : game.p2.name} ★★★`);
      renderLocalState(e.winnerRole);
    } else {
      console.error(e);
      gameLog.push(`發生錯誤:${e.message}`);
      renderLocalState();
    }
  }
}

// -- 畫面渲染 ---------------------------------------------------

function renderPublic(pub) {
  lastPublicSeen = pub;
  const mineKey = myRole === "p1" ? "p1" : "p2";
  const oppKey = myRole === "p1" ? "p2" : "p1";
  $("statusText").textContent = `第 ${pub.round} 回合`;
  renderBand($("oppBand"), pub[oppKey], true, null);
  renderBand($("myBand"), pub[mineKey], false, lastPrivateSeen);
  renderBattlefield(pub, oppKey, mineKey);
  renderLog(pub.log || []);
  if (pub.winnerRole) showGameOver(pub.winnerRole, pub);
}

function renderBand(container, snapshot, isOpp, privateData) {
  container.innerHTML = "";
  if (!snapshot) return;

  const nameEl = document.createElement("div");
  nameEl.className = "band-name";
  nameEl.textContent = snapshot.name + (isOpp ? "" : "(你)");
  container.appendChild(nameEl);

  const starsEl = document.createElement("div");
  starsEl.className = "badges";
  STAR_TYPES.forEach((t) => {
    const b = document.createElement("span");
    b.className = "badge badge-star";
    b.textContent = `${t} ${snapshot.stars[t]}`;
    starsEl.appendChild(b);
  });
  container.appendChild(starsEl);

  const pilesEl = document.createElement("div");
  pilesEl.className = "piles";
  pilesEl.appendChild(pileChip("太陽庫", snapshot.sunPileCount, "sun"));
  pilesEl.appendChild(pileChip("月亮庫", snapshot.moonPileCount, "moon"));
  pilesEl.appendChild(pileChip("棄牌", snapshot.discardCount, "discard"));
  container.appendChild(pilesEl);

  const handEl = document.createElement("div");
  handEl.className = "hand";
  if (isOpp) {
    handEl.appendChild(pileChip("太陽手牌", snapshot.handSunCount, "sun"));
    handEl.appendChild(pileChip("月亮手牌", snapshot.handMoonCount, "moon"));
  } else {
    const priv = privateData || { handSun: [], handMoon: [] };
    (priv.handSun || []).forEach((c) => handEl.appendChild(cardEl(c, "sun")));
    (priv.handMoon || []).forEach((c) => handEl.appendChild(cardEl(c, "moon")));
    if (!(priv.handSun || []).length && !(priv.handMoon || []).length) {
      const span = document.createElement("span");
      span.className = "dim";
      span.textContent = "(手上沒有太陽/月亮卡)";
      handEl.appendChild(span);
    }
  }
  container.appendChild(handEl);
}

function pileChip(label, count, kind) {
  const el = document.createElement("div");
  el.className = `chip chip-${kind}`;
  el.innerHTML = `<span class="chip-label">${label}</span><span class="chip-count">x${count}</span>`;
  return el;
}

function cardEl(name, kind) {
  const el = document.createElement("div");
  el.className = `card card-${kind}`;
  el.textContent = name;
  return el;
}

function renderBattlefield(pub, oppKey, mineKey) {
  const bf = $("battlefield");
  bf.innerHTML = "";
  bf.appendChild(battlefieldColumn(pub[oppKey], true, pub.starsRevealed, null));
  bf.appendChild(battlefieldColumn(pub[mineKey], false, pub.starsRevealed, lastPrivateSeen));
}

function battlefieldColumn(snapshot, isOpp, starsRevealed, privateData) {
  const col = document.createElement("div");
  col.className = "bf-col";
  if (!snapshot) return col;

  const label = document.createElement("div");
  label.className = "bf-label";
  label.textContent = snapshot.name + (isOpp ? "" : "(你)") + " 的出牌";
  col.appendChild(label);

  const row = document.createElement("div");
  row.className = "bf-row";

  row.appendChild(slotEl("太陽", snapshot.playedSun && snapshot.playedSun.length ? snapshot.playedSun.join("、") : null, "sun"));

  let starContent = null, starBack = false;
  if (isOpp && !starsRevealed) {
    starContent = "?";
    starBack = true;
  } else {
    starContent = snapshot.star || null;
  }
  row.appendChild(slotEl("星星", starContent, "star", starBack));

  let moonContent = null, moonBack = false;
  if (snapshot.playedMoon) {
    moonContent = snapshot.playedMoon;
  } else if (isOpp) {
    if (snapshot.moonPending) { moonContent = "?"; moonBack = true; }
  } else if (privateData && privateData.pendingMoonCard) {
    moonContent = privateData.pendingMoonCard;
  }
  row.appendChild(slotEl("月亮", moonContent, "moon", moonBack));

  col.appendChild(row);
  return col;
}

function slotEl(header, content, kind, back) {
  const wrap = document.createElement("div");
  wrap.className = "slot-wrap";
  const h = document.createElement("div");
  h.className = "slot-header";
  h.textContent = header;
  wrap.appendChild(h);
  const box = document.createElement("div");
  box.className = `slot-box ${content ? "slot-" + kind : "slot-empty"} ${back ? "slot-back" : ""}`;
  box.textContent = content ? content : "—";
  wrap.appendChild(box);
  return wrap;
}

function renderLog(lines) {
  const panel = $("logPanel");
  const wasAtBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 10;
  panel.textContent = lines.join("\n");
  if (wasAtBottom) panel.scrollTop = panel.scrollHeight;
}

function showGameOver(winnerRole, pub) {
  if (window.__gameOverShown) return;
  window.__gameOverShown = true;
  const name = winnerRole === "p1" ? pub.p1.name : pub.p2.name;
  setTimeout(() => alert(`遊戲結束!獲勝者:${name}`), 50);
}

// -- 彈窗(本地決策 modal,房主/加入者共用) --------------------------

function showLocalModal(title, prompt, options) {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalPrompt").textContent = prompt;
    const btnBox = $("modalButtons");
    btnBox.innerHTML = "";
    (options || []).forEach((opt) => {
      const b = document.createElement("button");
      b.textContent = opt.label;
      b.onclick = () => {
        $("modalOverlay").classList.add("hidden");
        resolve(opt.value === undefined ? null : opt.value);
      };
      btnBox.appendChild(b);
    });
    $("modalOverlay").classList.remove("hidden");
  });
}

function showRules() {
  $("rulesText").textContent = RULES_TEXT;
  $("rulesOverlay").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", init);
