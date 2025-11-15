const path = require('path')
const express = require('express')
const http = require('http')
const WebSocket = require('ws')

const app = express()

// Sert les fichiers statiques (index.html, player.html, main.js, player.js)
app.use(express.static(path.join(__dirname, '../public')))

// On pourra plus tard forcer / à index.html si besoin, mais static suffit.
const server = http.createServer(app)

// WebSocket attaché au même serveur HTTP
const wss = new WebSocket.Server({ server })

const PLAYER_COLORS = [
  '#e57373',
  '#64b5f6',
  '#81c784',
  '#fff176',
  '#ba68c8',
  '#ffb74d',
  '#4db6ac',
  '#dce775',
]

const tables = new Map()
const clientInfo = new Map()

function generateCode(length = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function createGameSession(rules) {
  return {
    rules,
    playersData: new Map(),
    currentRound: null,
  }
}

function startNewRound(session) {
  session.currentRound = {
    id: generateId('round'),
    status: 'betting',
    bets: [],
  }
}

function placeBet(session, playerId, amount) {
  if (!session.currentRound) return { error: 'No round started' }
  if (session.currentRound.status !== 'betting') return { error: 'Betting closed' }

  const pdata = session.playersData.get(playerId)
  if (!pdata) return { error: 'Unknown player' }

  if (amount < session.rules.minBet) return { error: `Bet below minimum (${session.rules.minBet})` }
  if (amount > session.rules.maxBet) return { error: `Bet above maximum (${session.rules.maxBet})` }
  if (amount > pdata.balance) return { error: 'Not enough balance' }

  pdata.balance -= amount

  session.currentRound.bets.push({
    playerId,
    handIndex: 1,
    amount,
    isDouble: false,
    outcome: null,
  })

  return { success: true }
}

function computeDelta(outcome, stake) {
  switch (outcome) {
    case 'lost':
    case 'bust':
      return 0
    case 'won':
      return stake * 2
    case 'blackjack':
      return Math.round(stake * 2.5)
    case 'push':
    default:
      return stake
  }
}

function broadcastTableState(table) {
  const session = table.session

  const playersPublic = table.players.map(p => {
    const pdata = session.playersData.get(p.id)
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      balance: pdata ? pdata.balance : 0,
    }
  })

  let roundInfo = null
  if (session.currentRound) {
    roundInfo = {
      id: session.currentRound.id,
      status: session.currentRound.status,
      bets: session.currentRound.bets.map(b => ({
        playerId: b.playerId,
        handIndex: b.handIndex,
        amount: b.amount,
        isDouble: b.isDouble,
        outcome: b.outcome,
      })),
    }
  }

  const payload = JSON.stringify({
    type: 'table_state',
    tableCode: table.code,
    players: playersPublic,
    round: roundInfo,
    rules: session.rules, // 🔥 on ajoute les règles ici
  })

  if (table.dealer.readyState === WebSocket.OPEN) {
    table.dealer.send(payload)
  }
  for (const p of table.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(payload)
    }
  }
}


function handleDisconnect(ws) {
  const info = clientInfo.get(ws)
  if (!info) return

  const { tableCode, role, playerId } = info
  const table = tables.get(tableCode)
  if (!table) {
    clientInfo.delete(ws)
    return
  }

  if (role === 'dealer') {
    console.log(`⚠️ Croupier déconnecté, on ferme la table ${tableCode}`)
    tables.delete(tableCode)
    for (const p of table.players) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(JSON.stringify({
          type: 'table_closed',
          reason: 'dealer_disconnected',
        }))
        p.ws.close()
      }
    }
  } else if (role === 'player') {
    console.log(`👋 Joueur ${playerId} quitte la table ${tableCode}`)
    table.players = table.players.filter(p => p.ws !== ws)
    table.session.playersData.delete(playerId)
    if (table.session.currentRound) {
      table.session.currentRound.bets = table.session.currentRound.bets.filter(
        b => b.playerId !== playerId
      )
    }
    broadcastTableState(table)
  }

  clientInfo.delete(ws)
}

function handleCreateTable(ws, msg) {
  const defaultRules = {
    minBet: 10,
    maxBet: 500,
    startingBalance: 1000,
  }

  let rules = defaultRules
  if (msg.rules) {
    const minBet = Number(msg.rules.minBet)
    const maxBet = Number(msg.rules.maxBet)
    const startingBalance = Number(msg.rules.startingBalance)
    if (
      !isNaN(minBet) && minBet > 0 &&
      !isNaN(maxBet) && maxBet >= minBet &&
      !isNaN(startingBalance) && startingBalance > 0
    ) {
      rules = { minBet, maxBet, startingBalance }
    }
  }

  let code
  do {
    code = generateCode(4)
  } while (tables.has(code))

  const dealerName = (msg.nickname || 'Croupier').trim() || 'Croupier'

  const session = createGameSession(rules)

  const table = {
    code,
    dealer: ws,
    players: [],
    session,
  }

  tables.set(code, table)
  clientInfo.set(ws, { tableCode: code, role: 'dealer' })

  console.log(`🟢 Nouvelle table créée : code=${code}, dealer=${dealerName}`)

  ws.send(JSON.stringify({
    type: 'table_created',
    tableCode: code,
    role: 'dealer',
    dealerName,
    rules,
  }))

  broadcastTableState(table)
}

function handleJoinTable(ws, msg) {
  const { tableCode, nickname } = msg
  if (!tableCode) {
    ws.send(JSON.stringify({ type: 'error', message: 'tableCode manquant' }))
    return
  }

  const table = tables.get(tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: `Table ${tableCode} introuvable` }))
    return
  }

  const existingInfo = clientInfo.get(ws)
  if (existingInfo && existingInfo.role === 'player' && existingInfo.tableCode === tableCode) {
    ws.send(JSON.stringify({ type: 'error', message: 'Tu es déjà connecté à cette table.' }))
    return
  }

  const alreadyInPlayers = table.players.some(p => p.ws === ws)
  if (alreadyInPlayers) {
    ws.send(JSON.stringify({ type: 'error', message: 'Tu es déjà dans la liste des joueurs.' }))
    return
  }

  const name = (nickname || '').trim()
  if (!name) {
    ws.send(JSON.stringify({ type: 'error', message: 'Pseudo invalide.' }))
    return
  }

  const lowerName = name.toLowerCase()
  const nameTaken = table.players.some(p => p.name.toLowerCase() === lowerName)
  if (nameTaken) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Ce pseudo est déjà utilisé à cette table. Choisis-en un autre.',
    }))
    return
  }

  const usedColors = table.players.map(p => p.color)
  const color = PLAYER_COLORS.find(c => !usedColors.includes(c)) || '#cccccc'

  const playerId = generateId('player')
  const player = { id: playerId, name, ws, color }

  table.players.push(player)
  clientInfo.set(ws, { tableCode, role: 'player', playerId })

  table.session.playersData.set(playerId, {
    balance: table.session.rules.startingBalance,
  })

  console.log(`🟢 Joueur ${name} (${playerId}) a rejoint la table ${tableCode}`)

  ws.send(JSON.stringify({
    type: 'joined_table',
    tableCode,
    role: 'player',
    playerId,
    name,
  }))

  broadcastTableState(table)
}

function handleStartRound(ws) {
  const info = clientInfo.get(ws)
  if (!info) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a table' }))
    return
  }
  if (info.role !== 'dealer') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only dealer can start round' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const session = table.session
  if (session.currentRound && session.currentRound.status === 'betting') {
    ws.send(JSON.stringify({ type: 'error', message: 'Une manche est déjà en cours.' }))
    return
  }

  startNewRound(session)
  console.log(`▶️ Nouvelle manche démarrée sur la table ${table.code}`)

  broadcastTableState(table)
}

function handlePlaceBet(ws, msg) {
  const info = clientInfo.get(ws)
  if (!info) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a table' }))
    return
  }
  if (info.role !== 'player') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only players can bet' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const session = table.session
  const round = session.currentRound
  if (!round || round.status !== 'betting') {
    ws.send(JSON.stringify({ type: 'error', message: 'Betting is not open' }))
    return
  }

  const alreadyHasBet = round.bets.some(b => b.playerId === info.playerId)
  if (alreadyHasBet) {
    ws.send(JSON.stringify({ type: 'error', message: 'Bet already placed for this round' }))
    return
  }

  const amount = Number(msg.amount)
  if (isNaN(amount) || amount <= 0) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid bet amount' }))
    return
  }

  const res = placeBet(session, info.playerId, amount)
  if (res.error) {
    ws.send(JSON.stringify({ type: 'error', message: res.error }))
  } else {
    console.log(`💰 Mise de ${amount} par joueur ${info.playerId} sur table ${table.code}`)
    broadcastTableState(table)
  }
}

function handleSplitBet(ws, msg) {
  const info = clientInfo.get(ws)
  if (!info || info.role !== 'dealer') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only dealer can split bets' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const session = table.session
  const round = session.currentRound
  if (!round || round.status !== 'betting') {
    ws.send(JSON.stringify({ type: 'error', message: 'No round started or betting closed' }))
    return
  }

  const betIndex = msg.betIndex
  const originalBet = round.bets[betIndex]
  if (!originalBet) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid bet index for split' }))
    return
  }

  const pdata = session.playersData.get(originalBet.playerId)
  if (!pdata) {
    ws.send(JSON.stringify({ type: 'error', message: 'Unknown player' }))
    return
  }

  if (pdata.balance < originalBet.amount) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Not enough balance to split this hand',
    }))
    return
  }

  pdata.balance -= originalBet.amount

  const samePlayerBets = round.bets.filter(b => b.playerId === originalBet.playerId)
  const maxHandIndex = samePlayerBets.reduce(
    (max, b) => Math.max(max, b.handIndex),
    1
  )
  const newHandIndex = maxHandIndex + 1

  const newBet = {
    playerId: originalBet.playerId,
    handIndex: newHandIndex,
    amount: originalBet.amount,
    isDouble: false,
    outcome: null,
  }

  round.bets.splice(betIndex + 1, 0, newBet)

  console.log(
    `✂️ Split sur mise #${betIndex} (joueur=${originalBet.playerId}, amount=${originalBet.amount}), nouvelle main #${newHandIndex}`
  )

  broadcastTableState(table)
}

function handleDoubleBet(ws, msg) {
  const info = clientInfo.get(ws)
  if (!info || info.role !== 'dealer') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only dealer can double bets' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const session = table.session
  const round = session.currentRound
  if (!round || round.status !== 'betting') {
    ws.send(JSON.stringify({ type: 'error', message: 'No round started or betting closed' }))
    return
  }

  const betIndex = msg.betIndex
  const bet = round.bets[betIndex]
  if (!bet) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid bet index for double' }))
    return
  }

  if (bet.isDouble || bet.outcome != null) {
    ws.send(JSON.stringify({ type: 'error', message: 'Bet already doubled or resolved' }))
    return
  }

  const pdata = session.playersData.get(bet.playerId)
  if (!pdata) {
    ws.send(JSON.stringify({ type: 'error', message: 'Unknown player' }))
    return
  }

  if (pdata.balance < bet.amount) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not enough balance to double' }))
    return
  }

  pdata.balance -= bet.amount
  bet.isDouble = true

  console.log(`🔁 Double sur mise #${betIndex} (joueur=${bet.playerId}, amount=${bet.amount})`)

  broadcastTableState(table)
}

function handleSetResults(ws, msg) {
  const info = clientInfo.get(ws)
  if (!info || info.role !== 'dealer') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only dealer can set results' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const session = table.session
  const round = session.currentRound
  if (!round) {
    ws.send(JSON.stringify({ type: 'error', message: 'No round started' }))
    return
  }

  const resultsLog = []

  for (const r of msg.results) {
    const betIndex = r.betIndex
    const outcome = r.outcome

    const bet = round.bets[betIndex]
    if (!bet) continue
    if (bet.outcome != null) continue

    const pdata = session.playersData.get(bet.playerId)
    if (!pdata) continue

    const stake = bet.amount * (bet.isDouble ? 2 : 1)
    const delta = computeDelta(outcome, stake)

    pdata.balance += delta
    bet.outcome = outcome

    resultsLog.push({
      playerId: bet.playerId,
      amount: bet.amount,
      isDouble: bet.isDouble,
      outcome,
      stake,
      delta,
      newBalance: pdata.balance,
    })
  }

  if (round.bets.length > 0 && round.bets.every(b => b.outcome != null)) {
    round.status = 'finished'
  }

  console.log("✔ Résultats appliqués :", resultsLog)

  broadcastTableState(table)
}

function handleResetTable(ws) {
  const info = clientInfo.get(ws)
  if (!info || info.role !== 'dealer') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only dealer can reset table' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const session = table.session

  for (const [, pdata] of session.playersData.entries()) {
    pdata.balance = session.rules.startingBalance
  }

  session.currentRound = null

  console.log(`🔄 Table ${table.code} réinitialisée (bankrolls remises à ${session.rules.startingBalance})`)

  broadcastTableState(table)
}

function handleKickPlayer(ws, msg) {
  const info = clientInfo.get(ws)
  if (!info || info.role !== 'dealer') {
    ws.send(JSON.stringify({ type: 'error', message: 'Only dealer can kick players' }))
    return
  }

  const table = tables.get(info.tableCode)
  if (!table) {
    ws.send(JSON.stringify({ type: 'error', message: 'Table not found' }))
    return
  }

  const { playerId } = msg
  if (!playerId) {
    ws.send(JSON.stringify({ type: 'error', message: 'playerId manquant pour kick' }))
    return
  }

  const player = table.players.find(p => p.id === playerId)
  if (!player) {
    ws.send(JSON.stringify({ type: 'error', message: 'Player not found in table' }))
    return
  }

  console.log(`⛔ Kick du joueur ${player.name} (${playerId}) de la table ${table.code}`)

  table.players = table.players.filter(p => p.id !== playerId)
  table.session.playersData.delete(playerId)
  if (table.session.currentRound) {
    table.session.currentRound.bets = table.session.currentRound.bets.filter(
      b => b.playerId !== playerId
    )
  }

  clientInfo.delete(player.ws)
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify({
      type: 'kicked',
      reason: 'kicked_by_dealer',
    }))
    player.ws.close()
  }

  broadcastTableState(table)
}

wss.on('connection', (ws) => {
  console.log('🟢 Nouveau client connecté')

  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connecté au serveur BlackjackBankroll',
  }))

  ws.on('message', (data) => {
    let msg
    const text = data.toString()

    try {
      msg = JSON.parse(text)
    } catch (e) {
      console.log('❌ Message non-JSON reçu, echo brut :', text)
      ws.send(JSON.stringify({ type: 'echo', received: text }))
      return
    }

    console.log('📩 Message JSON reçu :', msg)

    if (!msg.type) {
      ws.send(JSON.stringify({ type: 'error', message: 'Message sans type' }))
      return
    }

    switch (msg.type) {
      case 'create_table':
        handleCreateTable(ws, msg)
        break
      case 'join_table':
        handleJoinTable(ws, msg)
        break
      case 'start_round':
        handleStartRound(ws)
        break
      case 'place_bet':
        handlePlaceBet(ws, msg)
        break
      case 'split_bet':
        handleSplitBet(ws, msg)
        break
      case 'double_bet':
        handleDoubleBet(ws, msg)
        break
      case 'set_results':
        handleSetResults(ws, msg)
        break
      case 'reset_table':
        handleResetTable(ws)
        break
      case 'kick_player':
        handleKickPlayer(ws, msg)
        break
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: `Type de message inconnu: ${msg.type}`,
        }))
        break
    }
  })

  ws.on('close', () => {
    console.log('🔴 Client déconnecté')
    handleDisconnect(ws)
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Serveur HTTP+WebSocket démarré sur http://localhost:${PORT}`)
})
