const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Armazenar dados dos jogadores
let players = new Map();
let leaderboard = [];
let gameStates = new Map(); // Armazenar estados dos jogos em tempo real
// Tempo de inatividade (ms) antes de remover jogador
const INACTIVITY_MS = 10 * 1000; // 10 segundos
// Intervalo para checar inatividade
const INACTIVITY_CHECK_INTERVAL_MS = 2 * 1000; // 2 segundos
// Seed determinístico compartilhado entre clientes para gerar canos idênticos
const GAME_SEED = Math.floor(Math.random() * 1e9);
// Conjunto de sockets que estão na tela de leaderboard (espectadores)
const spectators = new Set();

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Conexões Socket.IO
io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    // enviar seed do jogo para que clientes gerem mapas idênticos
    socket.emit('gameSeed', GAME_SEED);

    // Não emitir leaderboard automaticamente aqui; clientes que estiverem
    // na tela de ranking devem enviar 'spectatorJoin' para receber updates.
    const currentLeaderOnConnect = getCurrentLeader();
    if (currentLeaderOnConnect) {
        const leaderGameState = gameStates.get(currentLeaderOnConnect.id);
        if (leaderGameState) {
            socket.emit('leaderGameState', {
                playerName: currentLeaderOnConnect.name,
                gameState: leaderGameState
            });
        }
    }

    // Jogador entra no jogo
    socket.on('playerJoin', (playerName) => {
        players.set(socket.id, {
            id: socket.id,
            name: playerName,
            score: 0,
            isPlaying: false
            , lastActivity: Date.now()
        });
        
        // não enviar leaderboard aqui — apenas espectadores recebem esse evento
        
        // Enviar estado do jogo do líder atual (se existir)
        const currentLeader = getCurrentLeader();
        if (currentLeader) {
            const leaderGameState = gameStates.get(currentLeader.id);
            if (leaderGameState) {
                socket.emit('leaderGameState', {
                    playerName: currentLeader.name,
                    gameState: leaderGameState
                });
            }
        }
        // Enviar lista atualizada de jogadores para todos
        broadcastAllPlayers();
    });

    // Jogador inicia o jogo
    socket.on('gameStart', () => {
        const player = players.get(socket.id);
        if (player) {
            player.isPlaying = true;
            player.score = 0;
            player.lastActivity = Date.now();
            broadcastAllPlayers();
        }
    });

    // Registro simples para clientes que estão na tela de leaderboard
    socket.on('spectatorJoin', () => {
        spectators.add(socket.id);
        socket.emit('leaderboardUpdate', leaderboard);
        // update activity
        const p = players.get(socket.id);
        if (p) p.lastActivity = Date.now();
    });

    // Receber estado do jogo em tempo real
    socket.on('gameStateUpdate', (gameState) => {
        const player = players.get(socket.id);
        if (player && player.isPlaying) {
            gameStates.set(socket.id, gameState);
            player.lastActivity = Date.now();
            
            // Verificar se este jogador é o líder atual
            const currentLeader = getCurrentLeader();
            if (currentLeader && currentLeader.id === socket.id) {
                // Enviar estado do jogo para todos os espectadores
                socket.broadcast.emit('leaderGameState', {
                    playerName: player.name,
                    gameState: gameState
                });
            }
            // Emitir estado de todos os jogadores para todos os clientes
            broadcastAllPlayers();
        }
    });

    // Atualizar pontuação
    socket.on('scoreUpdate', (score) => {
        const player = players.get(socket.id);
        if (player) {
            player.lastActivity = Date.now();
            const previousLeader = getCurrentLeader();
            player.score = score;
            
            // Enviar atualização para todos os clientes
            io.emit('playerScoreUpdate', {
                playerId: socket.id,
                playerName: player.name,
                score: score
            });
            // Atualizar todos os clientes com os estados
            broadcastAllPlayers();
            
            // Verificar se houve mudança de liderança
            const newLeader = getCurrentLeader();
            if (newLeader && (!previousLeader || newLeader.id !== previousLeader.id)) {
                // Novo líder - enviar seu estado de jogo para todos
                const newLeaderGameState = gameStates.get(newLeader.id);
                if (newLeaderGameState) {
                    io.emit('leaderGameState', {
                        playerName: newLeader.name,
                        gameState: newLeaderGameState
                    });
                }
            }
        }
    });

    // Game Over
    socket.on('gameOver', (finalScore) => {
        const player = players.get(socket.id);
        if (player) {
            const wasLeader = getCurrentLeader()?.id === socket.id;
            player.lastActivity = Date.now();
            player.isPlaying = false;
            player.score = finalScore;
            
            // Remover estado do jogo
            gameStates.delete(socket.id);
            
            // Atualizar leaderboard
            updateLeaderboard(player.name, finalScore);
            
            // Enviar leaderboard atualizado apenas para espectadores
            spectators.forEach(id => {
                const sock = io.sockets.sockets.get(id);
                if (sock) sock.emit('leaderboardUpdate', leaderboard);
            });
            
            // Atualizar e emitir lista de jogadores
            broadcastAllPlayers();

            // Se o líder terminou o jogo, encontrar novo líder
            if (wasLeader) {
                const newLeader = getCurrentLeader();
                if (newLeader) {
                    const newLeaderGameState = gameStates.get(newLeader.id);
                    if (newLeaderGameState) {
                        io.emit('leaderGameState', {
                            playerName: newLeader.name,
                            gameState: newLeaderGameState
                        });
                    }
                } else {
                    // Não há mais jogadores ativos
                    io.emit('leaderGameState', null);
                }
            }
        }
    });

    // Desconexão
    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
        const wasLeader = getCurrentLeader()?.id === socket.id;
        // Antes de remover, persistir pontuação final do jogador (se houver)
        const player = players.get(socket.id);
        if (player) {
            // Persistir somente se tiver pontuação válida (>0)
            if (typeof player.score === 'number' && player.score > 0) {
                updateLeaderboard(player.name, player.score);
                // Enviar leaderboard atualizado apenas para espectadores
                spectators.forEach(id => {
                    const sock = io.sockets.sockets.get(id);
                    if (sock) sock.emit('leaderboardUpdate', leaderboard);
                });
            }
        }

        // Remover jogador e estado após persistir
        players.delete(socket.id);
        gameStates.delete(socket.id);
        // remover de spectators caso estivesse registrado
        spectators.delete(socket.id);
        
        // Se o líder desconectou, encontrar novo líder
        if (wasLeader) {
            const newLeader = getCurrentLeader();
            if (newLeader) {
                const newLeaderGameState = gameStates.get(newLeader.id);
                if (newLeaderGameState) {
                    io.emit('leaderGameState', {
                        playerName: newLeader.name,
                        gameState: newLeaderGameState
                    });
                }
            } else {
                io.emit('leaderGameState', null);
            }
        }
        // emitir lista atualizada de jogadores após desconexão
        broadcastAllPlayers();
    });
});

// -- throttled broadcast implementation --
const BROADCAST_INTERVAL_MS = parseInt(process.env.BROADCAST_INTERVAL_MS);
let _lastBroadcastAt = 0;
let _broadcastTimer = null;
let _broadcastPending = false;
// Option: when true, broadcast payloads will include full gameState only for the leader
const BROADCAST_ONLY_LEADER = (process.env.BROADCAST_ONLY_LEADER === '1' || process.env.BROADCAST_ONLY_LEADER === 'true');

function _doBroadcastAllPlayers() {
    _broadcastTimer = null;
    _broadcastPending = false;
    _lastBroadcastAt = Date.now();

    const leader = getCurrentLeader();
    const leaderId = leader ? leader.id : null;

    if(BROADCAST_ONLY_LEADER && leader){
        const payload = leader;
        leader.gameState = gameStates.get(leader?.id) || null;
        io.emit('allPlayersUpdate', [payload]);
        return;
    }

    // Emit tailored payload per connected socket so we can hide pipes from spectators
    io.sockets.sockets.forEach((sock) => {
        const isSpectator = spectators.has(sock.id);
        const payload = Array.from(players.values()).map(p => {
            const base = {
                id: p.id,
                name: p.name,
                score: p.score,
                isPlaying: p.isPlaying
            };

            const gs = gameStates.get(p.id) || null;
            if (!gs) {
                base.gameState = null;
            } else if (isSpectator) {
                // For spectators, include pipes only for the current leader
                if (leaderId && p.id === leaderId) {
                    base.gameState = gs;
                } else {
                    // clone minimal gameState without pipes to avoid leaking other players' pipes
                    const clone = Object.assign({}, gs);
                    clone.pipes = [];
                    base.gameState = clone;
                }
            } else {
                // regular clients receive full gameState
                base.gameState = gs;
            }

            return base;
        });

        sock.emit('allPlayersUpdate', payload);
    });
}

function broadcastAllPlayers() {
    const now = Date.now();
    const since = now - _lastBroadcastAt;
    if (!_broadcastPending && since >= BROADCAST_INTERVAL_MS) {
        // safe to broadcast immediately
        _doBroadcastAllPlayers();
        return;
    }

    // otherwise schedule a pending broadcast to run after remaining time
    _broadcastPending = true;
    if (_broadcastTimer) return; // already scheduled

    const wait = Math.max(0, BROADCAST_INTERVAL_MS - since);
    _broadcastTimer = setTimeout(() => {
        _doBroadcastAllPlayers();
    }, wait);
}

// Função para encontrar o líder atual (jogador ativo com maior pontuação)
function getCurrentLeader() {
    let leader = null;
    let highestScore = -1;
    
    players.forEach((player) => {
        if (player.isPlaying && player.score > highestScore) {
            highestScore = player.score;
            leader = player;
        }
    });
    
    return leader;
}

// Função para atualizar leaderboard
function updateLeaderboard(playerName, score) {
    // Verificar se jogador já existe no leaderboard
    const existingIndex = leaderboard.findIndex(entry => entry.name === playerName);
    
    if (existingIndex !== -1) {
        // Atualizar se a nova pontuação for maior
        if (score > leaderboard[existingIndex].score) {
            leaderboard[existingIndex].score = score;
        }
    } else {
        // Adicionar novo jogador
        leaderboard.push({ name: playerName, score: score });
    }
    
    // Ordenar por pontuação (maior para menor) e manter apenas top 10
    leaderboard.sort((a, b) => b.score - a.score);
    leaderboard = leaderboard.slice(0, 10);
}

// Remove um jogador por inatividade
function removePlayerForInactivity(id) {
    const sock = io.sockets.sockets.get(id);
    const player = players.get(id);
    if (player) {
        // Persistir pontuação se houver
        if (typeof player.score === 'number' && player.score > 0) {
            updateLeaderboard(player.name, player.score);
            spectators.forEach(sid => {
                const s = io.sockets.sockets.get(sid);
                if (s) s.emit('leaderboardUpdate', leaderboard);
            });
        }
    }

    // Remover estado
    players.delete(id);
    gameStates.delete(id);
    spectators.delete(id);

    // Notificar o próprio socket se ainda conectado e desconectar
    if (sock) {
        try { sock.emit('removedForInactivity'); } catch (e) {}
        try { sock.disconnect(true); } catch (e) {}
    }

    // Atualizar clientes
    broadcastAllPlayers();
}

// Periodic check for inactive players
setInterval(() => {
    const now = Date.now();
    const inactive = [];
    players.forEach((p, id) => {
        const last = p.lastActivity || 0;
        if ((now - last) > INACTIVITY_MS && gameStates.get(id) != null) inactive.push(id);
    });
    if (inactive.length === 0) return;
    inactive.forEach(id => removePlayerForInactivity(id));
}, INACTIVITY_CHECK_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🐧 Flappy Penguin rodando na porta ${PORT}`);
});