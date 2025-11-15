"use strict";
let playerWs = null;
let playerCurrentTableCode = null;
let playerId = null;
let playerNameGlobal = null;
let playerBalance = null;
let playerCurrentRound = null;
let playersAtTable = [];
function byIdPlayer(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Element not found: ${id}`);
    return el;
}
function hasPlayerBetInCurrentRound() {
    if (!playerCurrentRound || !playerId)
        return false;
    return playerCurrentRound.bets.some(b => b.playerId === playerId);
}
function updateBetControlsEnabled() {
    const betAmountInput = byIdPlayer("bet-amount-input");
    const placeBetBtn = byIdPlayer("place-bet-btn");
    const clearBetBtn = byIdPlayer("clear-bet-btn");
    const chipButtons = document.querySelectorAll(".chip-btn");
    let enabled = false;
    if (playerWs &&
        playerWs.readyState === WebSocket.OPEN &&
        playerId &&
        playerCurrentTableCode &&
        playerCurrentRound &&
        playerCurrentRound.status === "betting" &&
        !hasPlayerBetInCurrentRound() &&
        playerBalance !== null &&
        playerBalance > 0) {
        enabled = true;
    }
    betAmountInput.disabled = !enabled;
    placeBetBtn.disabled = !enabled;
    clearBetBtn.disabled = !enabled;
    chipButtons.forEach(btn => {
        btn.disabled = !enabled;
    });
}
function renderPlayerInfo() {
    const playerNameLabel = byIdPlayer("player-name-label");
    const playerBalanceLabel = byIdPlayer("player-balance-label");
    playerNameLabel.textContent = playerNameGlobal !== null && playerNameGlobal !== void 0 ? playerNameGlobal : "-";
    playerBalanceLabel.textContent = playerBalance !== null ? String(playerBalance) : "-";
}
function renderRoundStatus() {
    const roundStatusLabel = byIdPlayer("round-status-label");
    if (!playerCurrentRound) {
        roundStatusLabel.textContent = "Aucune information";
        return;
    }
    if (playerCurrentRound.status === "betting") {
        roundStatusLabel.textContent = "Mises ouvertes";
    }
    else if (playerCurrentRound.status === "finished") {
        roundStatusLabel.textContent = "Manche terminée";
    }
    else {
        roundStatusLabel.textContent = playerCurrentRound.status;
    }
}
function renderPlayersAtTable() {
    const ul = byIdPlayer("players-list-player");
    ul.innerHTML = "";
    if (!playersAtTable || playersAtTable.length === 0) {
        const li = document.createElement("li");
        li.textContent = "Aucun joueur pour l'instant.";
        ul.appendChild(li);
        return;
    }
    for (const p of playersAtTable) {
        const li = document.createElement("li");
        li.style.marginBottom = "4px";
        const colorDot = document.createElement("span");
        colorDot.style.display = "inline-block";
        colorDot.style.width = "10px";
        colorDot.style.height = "10px";
        colorDot.style.borderRadius = "50%";
        colorDot.style.marginRight = "6px";
        colorDot.style.backgroundColor = p.color || "#888";
        const textSpan = document.createElement("span");
        textSpan.textContent = `${p.name} – solde: ${p.balance}`;
        li.appendChild(colorDot);
        li.appendChild(textSpan);
        ul.appendChild(li);
    }
}
// ---- Messages serveur ----
function handlePlayerMessage(msg) {
    const connectionStatus = byIdPlayer("connection-status");
    const betStatus = byIdPlayer("bet-status");
    if (msg.type === "welcome") {
        connectionStatus.style.color = "blue";
        connectionStatus.textContent = "Connecté au serveur.";
        return;
    }
    if (msg.type === "error") {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = `Erreur: ${msg.message}`;
        console.error("Erreur serveur côté joueur:", msg.message);
        return;
    }
    if (msg.type === "kicked") {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Tu as été expulsé de la table.";
        updateBetControlsEnabled();
        return;
    }
    if (msg.type === "joined_table") {
        playerCurrentTableCode = msg.tableCode;
        playerId = msg.playerId;
        playerNameGlobal = msg.name;
        connectionStatus.style.color = "green";
        connectionStatus.textContent = `Connecté à la table ${msg.tableCode} en tant que ${msg.name}.`;
        const connectJoinBtn = byIdPlayer("connect-join-btn");
        connectJoinBtn.disabled = true;
        renderPlayerInfo();
        updateBetControlsEnabled();
        return;
    }
    if (msg.type === "table_state") {
        playerCurrentTableCode = msg.tableCode;
        if (playerId) {
            const me = msg.players.find((p) => p.id === playerId);
            if (me) {
                playerBalance = me.balance;
            }
        }
        playersAtTable = msg.players || [];
        playerCurrentRound = msg.round || null;
        renderPlayerInfo();
        renderRoundStatus();
        renderPlayersAtTable();
        betStatus.textContent = "";
        updateBetControlsEnabled();
        return;
    }
    console.log("Message inconnu côté joueur:", msg);
}
// ---- Actions joueur ----
function connectAndJoinTable() {
    const connectionStatus = byIdPlayer("connection-status");
    const nameInput = byIdPlayer("player-name-input");
    const codeInput = byIdPlayer("table-code-input");
    const nickname = nameInput.value.trim();
    const tableCode = codeInput.value.trim().toUpperCase();
    if (!nickname) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Veuillez entrer un pseudo.";
        return;
    }
    if (!tableCode) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Veuillez entrer un code de table.";
        return;
    }
    if (playerWs && playerWs.readyState === WebSocket.OPEN && playerId && playerCurrentTableCode === tableCode) {
        connectionStatus.style.color = "green";
        connectionStatus.textContent = `Tu es déjà connecté à la table ${tableCode}.`;
        return;
    }
    const payload = {
        type: "join_table",
        tableCode,
        nickname,
    };
    if (playerWs && playerWs.readyState === WebSocket.OPEN) {
        playerWs.send(JSON.stringify(payload));
        connectionStatus.style.color = "blue";
        connectionStatus.textContent = "Demande de connexion à la table envoyée...";
        return;
    }
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = "Connexion au serveur...";
    const host = window.location.hostname || "localhost";
    playerWs = new WebSocket(`ws://${host}:3001`);
    playerWs.onopen = () => {
        connectionStatus.style.color = "blue";
        connectionStatus.textContent = "Connecté. Demande de rejoindre la table...";
        playerWs.send(JSON.stringify(payload));
    };
    playerWs.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handlePlayerMessage(msg);
        }
        catch (e) {
            console.error("Message non JSON reçu (joueur):", event.data);
        }
    };
    playerWs.onclose = () => {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Déconnecté du serveur.";
        updateBetControlsEnabled();
    };
    playerWs.onerror = () => {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Erreur de connexion au serveur.";
    };
}
function placePlayerBet() {
    const betStatus = byIdPlayer("bet-status");
    const betAmountInput = byIdPlayer("bet-amount-input");
    if (!playerWs || playerWs.readyState !== WebSocket.OPEN) {
        betStatus.style.color = "red";
        betStatus.textContent = "Pas connecté au serveur.";
        return;
    }
    if (!playerCurrentTableCode || !playerId) {
        betStatus.style.color = "red";
        betStatus.textContent = "Pas de table / joueur identifié.";
        return;
    }
    if (!playerCurrentRound || playerCurrentRound.status !== "betting") {
        betStatus.style.color = "red";
        betStatus.textContent = "Les mises ne sont pas ouvertes pour le moment.";
        return;
    }
    if (hasPlayerBetInCurrentRound()) {
        betStatus.style.color = "red";
        betStatus.textContent = "Tu as déjà misé pour cette manche.";
        updateBetControlsEnabled();
        return;
    }
    const amount = Number(betAmountInput.value);
    if (isNaN(amount) || amount <= 0) {
        betStatus.style.color = "red";
        betStatus.textContent = "Montant de mise invalide.";
        return;
    }
    if (playerBalance !== null && amount > playerBalance) {
        betStatus.style.color = "red";
        betStatus.textContent = "Montant supérieur à ton solde.";
        return;
    }
    const payload = {
        type: "place_bet",
        amount,
    };
    playerWs.send(JSON.stringify(payload));
    betStatus.style.color = "blue";
    betStatus.textContent = "Mise envoyée, en attente de confirmation du serveur.";
}
// ---- Jetons ----
function addChipAmount(amountToAdd) {
    const betStatus = byIdPlayer("bet-status");
    const betAmountInput = byIdPlayer("bet-amount-input");
    if (playerBalance === null || playerBalance <= 0) {
        betStatus.style.color = "red";
        betStatus.textContent = "Tu n'as pas de solde disponible.";
        return;
    }
    const current = Number(betAmountInput.value) || 0;
    let next = current + amountToAdd;
    if (next > playerBalance) {
        next = playerBalance;
        betStatus.style.color = "red";
        betStatus.textContent = "Tu ne peux pas miser plus que ton solde.";
    }
    else {
        betStatus.textContent = "";
    }
    betAmountInput.value = String(next);
}
function clearBetAmount() {
    const betAmountInput = byIdPlayer("bet-amount-input");
    betAmountInput.value = "";
    const betStatus = byIdPlayer("bet-status");
    betStatus.textContent = "";
}
// ---- Setup UI ----
function setupPlayerUI() {
    const connectJoinBtn = byIdPlayer("connect-join-btn");
    const placeBetBtn = byIdPlayer("place-bet-btn");
    const clearBetBtn = byIdPlayer("clear-bet-btn");
    connectJoinBtn.addEventListener("click", () => connectAndJoinTable());
    placeBetBtn.addEventListener("click", () => placePlayerBet());
    clearBetBtn.addEventListener("click", () => clearBetAmount());
    const chipButtons = document.querySelectorAll(".chip-btn");
    chipButtons.forEach(btn => {
        const valueAttr = btn.getAttribute("data-amount");
        const amount = valueAttr ? Number(valueAttr) : NaN;
        if (!isNaN(amount)) {
            btn.addEventListener("click", () => addChipAmount(amount));
        }
    });
    const connectionStatus = byIdPlayer("connection-status");
    connectionStatus.textContent = "Non connecté.";
    renderPlayerInfo();
    renderRoundStatus();
    renderPlayersAtTable();
    updateBetControlsEnabled();
}
document.addEventListener("DOMContentLoaded", () => {
    setupPlayerUI();
    console.log("UI Joueur initialisée.");
});
