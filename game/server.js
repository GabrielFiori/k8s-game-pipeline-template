const express = require('express');
const http = require('http');
const socketIo = require('socket.io');a
const path = require('path');a

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Armazenar dados dos jogadores
let players = new Map();
let leaderboard = [];
let gameStates = new Map(); // Armazenar estados dos jogos em tempo real

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Conexões Socket.IO
io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    // Jogador entra no jogo
    socket.on('playerJoin', (playerName) => {
        players.set(socket.id, {
            id: socket.id,
            name: playerName,
            score: 0,
            isPlaying: false
        });
        
        // Enviar leaderboard atual
        socket.emit('leaderboardUpdate', leaderboard);
        
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
    });

    // Jogador inicia o jogo
    socket.on('gameStart', () => {
        const player = players.get(socket.id);
        if (player) {
            player.isPlaying = true;
            player.score = 0;
        }
    });

    // Receber estado do jogo em tempo real
    socket.on('gameStateUpdate', (gameState) => {
        const player = players.get(socket.id);
        if (player && player.isPlaying) {
            gameStates.set(socket.id, gameState);
            
            // Verificar se este jogador é o líder atual
            const currentLeader = getCurrentLeader();
            if (currentLeader && currentLeader.id === socket.id) {
                // Enviar estado do jogo para todos os espectadores
                socket.broadcast.emit('leaderGameState', {
                    playerName: player.name,
                    gameState: gameState
                });
            }
        }
    });

    // Atualizar pontuação
    socket.on('scoreUpdate', (score) => {
        const player = players.get(socket.id);
        if (player) {
            const previousLeader = getCurrentLeader();
            player.score = score;
            
            // Enviar atualização para todos os clientes
            io.emit('playerScoreUpdate', {
                playerId: socket.id,
                playerName: player.name,
                score: score
            });
            
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
            
            player.isPlaying = false;
            player.score = finalScore;
            
            // Remover estado do jogo
            gameStates.delete(socket.id);
            
            // Atualizar leaderboard
            updateLeaderboard(player.name, finalScore);
            
            // Enviar leaderboard atualizado para todos
            io.emit('leaderboardUpdate', leaderboard);
            
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
        
        players.delete(socket.id);
        gameStates.delete(socket.id);
        
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
    });
});

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🐧 Flappy Penguin rodando na porta ${PORT}`);
});