"use strict";
let ws = null;
let currentTableCode = null;
let currentPlayers = [];
let currentRound = null;
function byId(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Element not found: ${id}`);
    return el;
}
function getPlayerState(playerId) {
    return currentPlayers.find(p => p.id === playerId);
}
// ---- Rendu UI joueurs ----
function renderPlayers() {
    const playersList = byId("players-list");
    playersList.innerHTML = "";
    if (currentPlayers.length === 0) {
        const li = document.createElement("li");
        li.textContent = "Aucun joueur pour l'instant.";
        playersList.appendChild(li);
        return;
    }
    for (const p of currentPlayers) {
        const li = document.createElement("li");
        li.style.marginBottom = "4px";
        const colorDot = document.createElement("span");
        colorDot.className = "player-dot";
        colorDot.style.backgroundColor = p.color || "#888";
        const textSpan = document.createElement("span");
        textSpan.textContent = `${p.name} – solde: ${p.balance}`;
        // Est-ce que ce joueur a misé dans la manche en cours ?
        let hasBet = false;
        if (currentRound) {
            hasBet = currentRound.bets.some(b => b.playerId === p.id);
        }
        const badgesContainer = document.createElement("span");
        badgesContainer.style.marginLeft = "6px";
        if (hasBet) {
            const badge = document.createElement("span");
            badge.className = "badge-bet";
            badge.textContent = "Mise placée";
            badgesContainer.appendChild(badge);
        }
        const kickBtn = document.createElement("button");
        kickBtn.textContent = "Virer";
        kickBtn.className = "btn btn-outline btn-sm";
        kickBtn.style.marginLeft = "auto";
        kickBtn.onclick = () => kickPlayer(p.id);
        li.appendChild(colorDot);
        li.appendChild(textSpan);
        li.appendChild(badgesContainer);
        li.appendChild(kickBtn);
        playersList.appendChild(li);
    }
}
// ---- Rendu UI manches/mises ----
function renderRound() {
    const roundStatusLabel = byId("round-status-label");
    const betsList = byId("bets-list");
    const startRoundBtn = document.getElementById("start-round-btn");
    betsList.innerHTML = "";
    if (!currentRound) {
        roundStatusLabel.textContent = "Aucune manche";
        if (startRoundBtn) {
            startRoundBtn.disabled = false;
            startRoundBtn.textContent = "Démarrer une nouvelle manche";
        }
        const li = document.createElement("li");
        li.textContent = "Aucune mise pour l'instant.";
        betsList.appendChild(li);
        return;
    }
    if (currentRound.status === "betting") {
        roundStatusLabel.textContent = "Mises en cours";
        if (startRoundBtn) {
            startRoundBtn.disabled = true;
            startRoundBtn.textContent = "Manche en cours";
        }
    }
    else if (currentRound.status === "finished") {
        roundStatusLabel.textContent = "Manche terminée";
        if (startRoundBtn) {
            startRoundBtn.disabled = false;
            startRoundBtn.textContent = "Démarrer une nouvelle manche";
        }
    }
    else {
        roundStatusLabel.textContent = currentRound.status;
    }
    if (currentRound.bets.length === 0) {
        const li = document.createElement("li");
        li.textContent = "Aucune mise enregistrée pour cette manche.";
        betsList.appendChild(li);
        return;
    }
    for (let i = 0; i < currentRound.bets.length; i++) {
        const bet = currentRound.bets[i];
        const player = getPlayerState(bet.playerId);
        const playerName = player ? player.name : "Inconnu";
        const availableBalance = player ? player.balance : 0;
        const li = document.createElement("li");
        li.style.marginBottom = "8px";
        if (bet.handIndex > 1) {
            li.style.marginLeft = "20px";
        }
        // couleur joueur
        const colorDot = document.createElement("span");
        colorDot.style.display = "inline-block";
        colorDot.style.width = "10px";
        colorDot.style.height = "10px";
        colorDot.style.borderRadius = "50%";
        colorDot.style.marginRight = "6px";
        colorDot.style.backgroundColor = (player === null || player === void 0 ? void 0 : player.color) || "#888";
        li.appendChild(colorDot);
        const textSpan = document.createElement("span");
        let text = `${playerName} – main ${bet.handIndex} – mise: ${bet.amount}`;
        if (bet.isDouble)
            text += " (Double)";
        if (bet.outcome)
            text += ` – résultat: ${bet.outcome}`;
        textSpan.textContent = text;
        li.appendChild(textSpan);
        const canActOnHand = currentRound.status === "betting" && !bet.outcome && player != null;
        const canDouble = canActOnHand && !bet.isDouble && availableBalance >= bet.amount;
        const canSplit = canActOnHand && availableBalance >= bet.amount;
        // Bouton Double (plus de checkbox)
        const doubleBtn = document.createElement("button");
        doubleBtn.textContent = "Double";
        doubleBtn.disabled = !canDouble;
        doubleBtn.className = "result-btn result-bj";
        doubleBtn.onclick = () => requestDouble(i);
        const resultDisabled = !!bet.outcome;
        const btnLost = document.createElement("button");
        btnLost.textContent = "Perdu";
        btnLost.disabled = resultDisabled;
        btnLost.className = "result-btn result-lost";
        btnLost.onclick = () => setBetOutcome(i, "lost");
        const btnBust = document.createElement("button");
        btnBust.textContent = "Bust";
        btnBust.disabled = resultDisabled;
        btnBust.className = "result-btn result-bust";
        btnBust.onclick = () => setBetOutcome(i, "bust");
        const btnWon = document.createElement("button");
        btnWon.textContent = "Gagné";
        btnWon.disabled = resultDisabled;
        btnWon.className = "result-btn result-won";
        btnWon.onclick = () => setBetOutcome(i, "won");
        const btnBJ = document.createElement("button");
        btnBJ.textContent = "Blackjack";
        btnBJ.disabled = resultDisabled;
        btnBJ.className = "result-btn result-bj";
        btnBJ.onclick = () => setBetOutcome(i, "blackjack");
        const btnPush = document.createElement("button");
        btnPush.textContent = "Push";
        btnPush.disabled = resultDisabled;
        btnPush.className = "result-btn result-push";
        btnPush.onclick = () => setBetOutcome(i, "push");
        const btnSplit = document.createElement("button");
        btnSplit.textContent = "Split";
        btnSplit.disabled = !canSplit;
        btnSplit.className = "result-btn result-won";
        btnSplit.onclick = () => requestSplit(i);
        // petit conteneur pour aligner proprement les boutons
        const buttonsContainer = document.createElement("span");
        buttonsContainer.style.marginLeft = "8px";
        buttonsContainer.append(doubleBtn, btnLost, btnBust, btnWon, btnBJ, btnPush, btnSplit);
        li.append(" — ", buttonsContainer);
        betsList.appendChild(li);
    }
}
// ---- Actions vers le serveur ----
function setBetOutcome(betIndex, outcome) {
    const connectionStatus = byId("connection-status");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Pas connecté au serveur (setBetOutcome).";
        return;
    }
    if (!currentRound) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Aucune manche en cours pour appliquer un résultat.";
        return;
    }
    const payload = {
        type: "set_results",
        results: [
            {
                betIndex,
                outcome,
            },
        ],
    };
    ws.send(JSON.stringify(payload));
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = `Résultat "${outcome}" envoyé pour la mise #${betIndex}.`;
}
function requestSplit(betIndex) {
    const connectionStatus = byId("connection-status");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Pas connecté au serveur (split).";
        return;
    }
    if (!currentRound) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Aucune manche en cours pour split.";
        return;
    }
    const payload = {
        type: "split_bet",
        betIndex,
    };
    ws.send(JSON.stringify(payload));
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = `Demande de split envoyée pour la mise #${betIndex}.`;
}
function requestDouble(betIndex) {
    const connectionStatus = byId("connection-status");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Pas connecté au serveur (double).";
        return;
    }
    if (!currentRound) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Aucune manche en cours pour double.";
        return;
    }
    const payload = {
        type: "double_bet",
        betIndex,
    };
    ws.send(JSON.stringify(payload));
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = `Demande de double envoyée pour la mise #${betIndex}.`;
}
function resetTable() {
    const connectionStatus = byId("connection-status");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Pas connecté au serveur (reset).";
        return;
    }
    const payload = { type: "reset_table" };
    ws.send(JSON.stringify(payload));
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = "Réinitialisation de la table demandée.";
}
function kickPlayer(playerId) {
    const connectionStatus = byId("connection-status");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Pas connecté au serveur (kick).";
        return;
    }
    const payload = {
        type: "kick_player",
        playerId,
    };
    ws.send(JSON.stringify(payload));
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = `Demande de kick envoyée pour le joueur ${playerId}.`;
}
// ---- Gestion des messages ----
function handleMessage(msg) {
    const connectionStatus = byId("connection-status");
    const tableCodeLabel = byId("table-code-label");
    if (msg.type === "welcome") {
        connectionStatus.style.color = "blue";
        connectionStatus.textContent = "Connecté au serveur.";
        return;
    }
    if (msg.type === "error") {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = `Erreur: ${msg.message}`;
        console.error("Erreur serveur:", msg.message);
        return;
    }
    if (msg.type === "table_created") {
        currentTableCode = msg.tableCode;
        tableCodeLabel.textContent = msg.tableCode;
        connectionStatus.style.color = "green";
        connectionStatus.textContent = `Table créée. Code: ${msg.tableCode}`;
        const minInput = byId("min-bet-input");
        const maxInput = byId("max-bet-input");
        const startingInput = byId("starting-balance-input");
        minInput.value = String(msg.rules.minBet);
        maxInput.value = String(msg.rules.maxBet);
        startingInput.value = String(msg.rules.startingBalance);
        minInput.disabled = true;
        maxInput.disabled = true;
        startingInput.disabled = true;
        return;
    }
    if (msg.type === "table_state") {
        currentTableCode = msg.tableCode;
        tableCodeLabel.textContent = msg.tableCode;
        currentPlayers = msg.players || [];
        currentRound = msg.round || null;
        renderPlayers();
        renderRound();
        return;
    }
    console.log("Message inconnu côté front:", msg);
}
// ---- Connexion / création ----
function connectAndCreateTable() {
    const connectionStatus = byId("connection-status");
    const dealerNameInput = byId("dealer-name-input");
    const minInput = byId("min-bet-input");
    const maxInput = byId("max-bet-input");
    const startingInput = byId("starting-balance-input");
    const dealerName = dealerNameInput.value.trim();
    if (!dealerName) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Veuillez entrer un pseudo croupier.";
        return;
    }
    const minBet = Number(minInput.value);
    const maxBet = Number(maxInput.value);
    const startingBalance = Number(startingInput.value);
    if (isNaN(minBet) || minBet <= 0) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Mise minimale invalide.";
        return;
    }
    if (isNaN(maxBet) || maxBet < minBet) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Mise maximale invalide.";
        return;
    }
    if (isNaN(startingBalance) || startingBalance <= 0) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Solde initial invalide.";
        return;
    }
    const payload = {
        type: "create_table",
        nickname: dealerName,
        rules: {
            minBet,
            maxBet,
            startingBalance,
        },
    };
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        connectionStatus.style.color = "blue";
        connectionStatus.textContent = "Demande de création de table envoyée...";
        return;
    }
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = "Connexion au serveur...";
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsHost = window.location.host;
    ws = new WebSocket(`${wsProtocol}://${wsHost}`);
    ws.onopen = () => {
        connectionStatus.style.color = "blue";
        connectionStatus.textContent = "Connecté. Création de la table...";
        ws.send(JSON.stringify(payload));
    };
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
        }
        catch (e) {
            console.error("Message non JSON reçu:", event.data);
        }
    };
    ws.onclose = () => {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Déconnecté du serveur.";
    };
    ws.onerror = () => {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Erreur de connexion au serveur.";
    };
}
function startRound() {
    const connectionStatus = byId("connection-status");
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Pas connecté au serveur.";
        return;
    }
    if (!currentTableCode) {
        connectionStatus.style.color = "red";
        connectionStatus.textContent = "Aucune table créée.";
        return;
    }
    const payload = { type: "start_round" };
    ws.send(JSON.stringify(payload));
    connectionStatus.style.color = "blue";
    connectionStatus.textContent = "Demande de nouvelle manche envoyée.";
}
// ---- Setup ----
function setupUI() {
    const connectCreateBtn = byId("connect-create-btn");
    const startRoundBtn = byId("start-round-btn");
    const resetTableBtn = byId("reset-table-btn");
    connectCreateBtn.addEventListener("click", () => connectAndCreateTable());
    startRoundBtn.addEventListener("click", () => startRound());
    resetTableBtn.addEventListener("click", () => resetTable());
    const connectionStatus = byId("connection-status");
    connectionStatus.textContent = "Non connecté.";
}
document.addEventListener("DOMContentLoaded", () => {
    setupUI();
    console.log("UI Croupier initialisée.");
});
