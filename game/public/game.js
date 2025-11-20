// Configuração do jogo
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();
// Áudio por arquivo (pass.wav / flap.wav) - sem fallback por síntese
const passAudio = new Audio('pass.mp3');
passAudio.preload = 'auto';
const flapAudio = new Audio('flap.mp3');
flapAudio.preload = 'auto';

// Pools para elementos HTMLAudio como fallback (reuso evita re-downloads)
const AUDIO_POOL_SIZE = 6;
const passAudioPool = [];
const flapAudioPool = [];
let passAudioIndex = 0;
let flapAudioIndex = 0;

function initAudioPools() {
    for (let i = 0; i < AUDIO_POOL_SIZE; i++) {
        const pa = new Audio(passAudio.src);
        pa.preload = 'auto';
        passAudioPool.push(pa);

        const fa = new Audio(flapAudio.src);
        fa.preload = 'auto';
        flapAudioPool.push(fa);
    }
}
// initialize pools (won't force downloads until user gesture allows playback)
initAudioPools();

// Offscreen background buffer to avoid expensive redraws each frame
let bgCanvas = null;
let bgCtx = null;
let bgNeedsUpdate = true;

function renderBackgroundBuffer() {
    if (!bgCanvas) {
        bgCanvas = document.createElement('canvas');
        bgCtx = bgCanvas.getContext('2d');
    }
    if (bgCanvas.width !== canvas.width || bgCanvas.height !== canvas.height) {
        bgCanvas.width = canvas.width;
        bgCanvas.height = canvas.height;
    }

    // Céu gradiente
    const gradient = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
    gradient.addColorStop(0, '#74b9ff');
    gradient.addColorStop(1, '#0984e3');
    bgCtx.fillStyle = gradient;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    // Nuvens simples
    bgCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    bgCtx.beginPath();
    bgCtx.arc(100, 100, 30, 0, Math.PI * 2);
    bgCtx.arc(120, 100, 40, 0, Math.PI * 2);
    bgCtx.arc(140, 100, 30, 0, Math.PI * 2);
    bgCtx.fill();

    bgCtx.beginPath();
    bgCtx.arc(300, 150, 25, 0, Math.PI * 2);
    bgCtx.arc(315, 150, 35, 0, Math.PI * 2);
    bgCtx.arc(330, 150, 25, 0, Math.PI * 2);
    bgCtx.fill();

    bgNeedsUpdate = false;
}

// In-memory audio buffers (decoded) to avoid re-downloading/creating elements each play
let audioCtx = null;
const audioBuffers = { pass: null, flap: null };
let audioLoadPromise = null;

function ensureAudioLoaded() {
    if (audioLoadPromise) return audioLoadPromise;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('WebAudio not supported, will use HTMLAudio fallback', e);
        return Promise.resolve();
    }

    const load = async (url) => {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        return await audioCtx.decodeAudioData(ab);
    };

    audioLoadPromise = Promise.all([
        load('pass.mp3').catch(err => { console.warn('pass.mp3 load failed', err); return null; }),
        load('flap.mp3').catch(err => { console.warn('flap.mp3 load failed', err); return null; })
    ]).then(([passBuf, flapBuf]) => {
        audioBuffers.pass = passBuf;
        audioBuffers.flap = flapBuf;
    }).catch(err => {
        console.warn('Audio buffers load error', err);
    });

    return audioLoadPromise;
}

function playPassSound() {
    // Prefer in-memory decoded buffer when available
    try {
        if (audioBuffers.pass && audioCtx) {
            const startSource = () => {
                const src = audioCtx.createBufferSource();
                src.buffer = audioBuffers.pass;
                src.connect(audioCtx.destination);
                src.start();
            };
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().then(startSource).catch(() => startSource());
            } else {
                startSource();
            }
            return;
        }

        // Fallback: use pooled HTMLAudio elements to allow overlapping without re-download
        try {
            const a = passAudioPool[passAudioIndex % passAudioPool.length];
            passAudioIndex++;
            a.currentTime = 0;
            a.play().catch(() => {});
        } catch (e) {
            passAudio.currentTime = 0;
            passAudio.play().catch(() => {});
        }
    } catch (e) {
        console.warn('playPassSound failed', e);
    }
}

function playJumpSound() {
    try {
        if (audioBuffers.flap && audioCtx) {
            const startSource = () => {
                const src = audioCtx.createBufferSource();
                src.buffer = audioBuffers.flap;
                src.connect(audioCtx.destination);
                src.start();
            };
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().then(startSource).catch(() => startSource());
            } else {
                startSource();
            }
            return;
        }

        // Fallback: use pooled HTMLAudio elements to allow overlapping without re-download
        try {
            const a = flapAudioPool[flapAudioIndex % flapAudioPool.length];
            flapAudioIndex++;
            a.currentTime = 0;
            a.play().catch(() => {});
        } catch (e) {
            flapAudio.currentTime = 0;
            flapAudio.play().catch(() => {});
        }
    } catch (e) {
        console.warn('playJumpSound failed', e);
    }
}

// Elementos da interface
const scoreElement = document.getElementById('score');
const playerNameDisplay = document.getElementById('playerNameDisplay');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreElement = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');
const menuBtn = document.getElementById('menuBtn');
const backBtn = document.getElementById('backBtn');

// Variáveis do jogo
let game = {
    penguin: {
        x: 50,
        y: canvas.height / 2,
        width: 40,
        height: 30,
        velocity: 0,
        gravity: 0.5,
        jump: -8,
        rotation: 0
    },
    pipes: [],
    score: 0,
    gameRunning: false,
    gameStarted: false
};

// Multiplayer state
let allPlayers = [];
let mySocketId = null;
// sequência local para identificar pipes (permite mapear pipes entre clientes)
let localPipeSeq = 0;
// posição global do jogador no eixo X (world coordinate)
let myWorldX = 0;

const PIPE_WIDTH = 60;
const PIPE_GAP = 150;
const PIPE_SPEED = 2;
// Deterministic pipe generation when seed is provided by server
let GAME_SEED = null;
let pregeneratedPipeHeights = [];
const PREGENERATED_COUNT = 500; // number of pipes to pregenerate per run

function mulberry32(a) {
    return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t>>>14) >>> 0) / 4294967296;
    }
}

function generatePipeHeightsFromSeed(count, seed) {
    const arr = [];
    const rng = mulberry32(Number(seed));
    const minHeight = 50;
    const maxHeight = canvas.height - PIPE_GAP - minHeight;
    for (let i = 0; i < count; i++) {
        arr.push(rng() * (maxHeight - minHeight) + minHeight);
    }
    return arr;
}

// Configurar jogador
const playerName = localStorage.getItem('playerName') || 'Pinguim Anônimo';
playerNameDisplay.textContent = `Jogador: ${playerName}`;

// Conectar ao servidor
socket.emit('playerJoin', playerName);

// store our socket id
socket.on('connect', () => {
    mySocketId = socket.id;
});

// Receive full players list
socket.on('allPlayersUpdate', (players) => {
    if (!Array.isArray(players)) return;
    allPlayers = players;
});

// Receber seed do servidor para geração determinística do mapa
socket.on('gameSeed', (seed) => {
    try {
        GAME_SEED = Number(seed);
        // pregenerate a batch of pipe heights so clients have the same layout
        pregeneratedPipeHeights = generatePipeHeightsFromSeed(PREGENERATED_COUNT, GAME_SEED);
        console.log('Received game seed:', GAME_SEED);
    } catch (e) {
        console.warn('Invalid game seed', seed);
    }
});

// Prevenir comportamentos indesejados no mobile
function preventMobileBehaviors() {
    // Prevenir zoom duplo toque
    document.addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });

    // Prevenir zoom com gesture
    document.addEventListener('gesturestart', function(e) {
        e.preventDefault();
    }, { passive: false });

    // Prevenir seleção de texto no canvas
    canvas.addEventListener('selectstart', function(e) {
        e.preventDefault();
    }, { passive: false });

    // Prevenir menu contextual
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    }, { passive: false });

    // Prevenir drag
    canvas.addEventListener('dragstart', function(e) {
        e.preventDefault();
    }, { passive: false });

    // Prevenir highlight no mobile
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', function(e) {
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', function(e) {
        e.preventDefault();
    }, { passive: false });
}

// Inicializar jogo
function initGame() {
    game.penguin.x = 50;
    game.penguin.y = canvas.height / 2;
    game.penguin.velocity = 0;
    game.penguin.rotation = 0;
    game.pipes = [];
    game.score = 0;
    game.gameRunning = true;
    game.gameStarted = true;
    
    scoreElement.textContent = game.score;
    gameOverScreen.classList.add('hidden');
    
    socket.emit('gameStart');
    myWorldX = 0;
    // when starting a new run, regenerate pregenerated pipes so restarts are identical
    if (GAME_SEED) {
        pregeneratedPipeHeights = generatePipeHeightsFromSeed(PREGENERATED_COUNT, GAME_SEED);
    }
    generatePipe();
}

// Gerar canos
function generatePipe() {
    const minHeight = 50;
    const maxHeight = canvas.height - PIPE_GAP - minHeight;
    let topHeight;
    if (pregeneratedPipeHeights && pregeneratedPipeHeights.length > 0) {
        topHeight = pregeneratedPipeHeights.shift();
    } else {
        topHeight = Math.random() * (maxHeight - minHeight) + minHeight;
    }
    
    game.pipes.push({
        x: canvas.width,
        topHeight: topHeight,
        bottomY: topHeight + PIPE_GAP,
        passed: false,
        midPlayed: false
        , seq: localPipeSeq++
    });
}

// Pulo do pinguim
function jump() {
    if (!game.gameStarted) {
        initGame();
        return;
    }
    
    if (game.gameRunning) {
        game.penguin.velocity = game.penguin.jump;
        // garantir que o áudio foi inicializado a partir de uma interação do usuário
        try { ensureAudioLoaded(); } catch (e) {}
        // som de flap ao pular
        playJumpSound();
    }
}

// Desenhar pinguim
function drawPenguin() {
    ctx.save();
    
    // Rotação baseada na velocidade
    game.penguin.rotation = Math.min(Math.max(game.penguin.velocity * 3, -30), 90);
    
    ctx.translate(game.penguin.x + game.penguin.width/2, game.penguin.y + game.penguin.height/2);
    ctx.rotate(game.penguin.rotation * Math.PI / 180);
    
    // Corpo do pinguim
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(-game.penguin.width/2, -game.penguin.height/2, game.penguin.width, game.penguin.height);
    
    // Barriga branca
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-game.penguin.width/3, -game.penguin.height/3, game.penguin.width/1.5, game.penguin.height/1.5);
    
    // Bico
    ctx.fillStyle = '#f39c12';
    ctx.fillRect(game.penguin.width/2 - 5, -3, 8, 6);
    
    // Olho
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(game.penguin.width/4, -game.penguin.height/3, 8, 8);
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(game.penguin.width/4 + 2, -game.penguin.height/3 + 2, 4, 4);
    
    ctx.restore();
}

// Desenha os pinguins dos outros jogadores usando seus gameState enviados pelo servidor
function drawOtherPlayers() {
    if (!Array.isArray(allPlayers) || allPlayers.length === 0) return;
    for (const p of allPlayers) {
        try {
            if (!p || !p.isPlaying || !p.gameState) continue;
            if (p.id === mySocketId) continue; // não desenhar o próprio aqui
            const peng = p.gameState.penguin;
            if (!peng) continue;

            // Normalizar Y: clientes podem ter tamanhos de canvas diferentes
            const remoteCanvasH = (p.gameState && p.gameState.canvasHeight) || canvas.height;
            const renderY = (peng && remoteCanvasH) ? (peng.y / remoteCanvasH) * canvas.height : (canvas.height/2);

            // Calcular X relativo ao jogador local
            // Priorizar diferença de score para determinar frente/atrás
            const scoreDiff = (p.score || 0) - (game.score || 0);
            const SCORE_PIXEL = 40; // pixels per score difference fallback
            let baseRenderX = game.penguin.x + scoreDiff * SCORE_PIXEL;
            let renderX = baseRenderX;
            try {
                // Prefer using worldX if available (absolute positioning)
                if (p.gameState && typeof p.gameState.worldX === 'number' && typeof myWorldX === 'number') {
                    renderX = game.penguin.x + (p.gameState.worldX - myWorldX);
                } else if (Array.isArray(p.gameState && p.gameState.pipes) && p.gameState.pipes.length > 0 && Array.isArray(game.pipes) && game.pipes.length > 0) {
                    // Prefer matching by sequence id if available
                    const remoteSeqPipe = p.gameState.pipes.find(pipe => pipe && (pipe.seq !== undefined));
                    let candidateX = null;
                    if (remoteSeqPipe) {
                        const localMatch = game.pipes.find(pipe => pipe && pipe.seq === remoteSeqPipe.seq);
                        if (localMatch) {
                            const delta = remoteSeqPipe.x - localMatch.x;
                            candidateX = game.penguin.x + delta;
                        } else {
                            // fallback to first visible pipe delta
                            const remoteFirstX = p.gameState.pipes[0].x;
                            const localFirstX = game.pipes[0].x;
                            const delta = remoteFirstX - localFirstX;
                            candidateX = game.penguin.x + delta;
                        }
                    } else {
                        const remoteFirstX = p.gameState.pipes[0].x;
                        const localFirstX = game.pipes[0].x;
                        const delta = remoteFirstX - localFirstX;
                        candidateX = game.penguin.x + delta;
                    }
                    // Use candidate only if it agrees with scoreDiff direction (front/behind), otherwise prefer score-based base
                    if (typeof candidateX === 'number') {
                        const rel = candidateX - game.penguin.x;
                        if (scoreDiff === 0) {
                            // if scores equal, accept candidate
                            renderX = candidateX;
                        } else if ((rel > 0 && scoreDiff > 0) || (rel < 0 && scoreDiff < 0)) {
                            renderX = candidateX;
                        } else {
                            // conflicting direction: prefer score-based baseRenderX
                            renderX = baseRenderX;
                        }
                    }
                }
            } catch (err) {
                renderX = baseRenderX;
            }

            // Desenhar com sombreamento: usar alpha mais baixa para diferenciar
            ctx.save();
            ctx.globalAlpha = 0.7;
            const rotation = Math.min(Math.max((peng && peng.velocity) ? peng.velocity * 3 : 0, -30), 90);
            ctx.translate(renderX + game.penguin.width/2, renderY + game.penguin.height/2);
            ctx.rotate(rotation * Math.PI / 180);
            // jogadores remotos em cinza
            ctx.fillStyle = 'rgba(45,52,54,0.9)';
            ctx.fillRect(-game.penguin.width/2, -game.penguin.height/2, game.penguin.width, game.penguin.height);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(-game.penguin.width/3, -game.penguin.height/3, game.penguin.width/1.5, game.penguin.height/1.5);
            ctx.fillStyle = 'rgba(243,156,18,0.9)';
            ctx.fillRect(game.penguin.width/2 - 5, -3, 8, 6);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(game.penguin.width/4, -game.penguin.height/3, 8, 8);
            ctx.fillStyle = 'rgba(45,52,54,0.9)';
            ctx.fillRect(game.penguin.width/4 + 2, -game.penguin.height/3 + 2, 4, 4);
            ctx.restore();
            // nome com sombra leve
            ctx.save();
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(45,52,54,0.9)';
            ctx.fillText(p.name, renderX + game.penguin.width/2, renderY - 10);
            ctx.restore();
        } catch (e) {
            // proteger contra dados inválidos
            console.warn('drawOtherPlayers error for', p && p.id, e);
            continue;
        }
    }
}

// Desenhar canos
function drawPipes() {
    // Draw pipe bodies with a single fillStyle to avoid frequent state changes
    ctx.fillStyle = '#27ae60';
    for (let i = 0; i < game.pipes.length; i++) {
        const pipe = game.pipes[i];
        // Cano superior
        ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);

        // Cano inferior
        ctx.fillRect(pipe.x, pipe.bottomY, PIPE_WIDTH, canvas.height - pipe.bottomY);
    }

    // Draw pipe borders in a separate pass with a different color
    ctx.fillStyle = '#229954';
    for (let i = 0; i < game.pipes.length; i++) {
        const pipe = game.pipes[i];
        ctx.fillRect(pipe.x - 5, pipe.topHeight - 30, PIPE_WIDTH + 10, 30);
        ctx.fillRect(pipe.x - 5, pipe.bottomY, PIPE_WIDTH + 10, 30);
    }
    // restore primary fillStyle for any subsequent drawing
    ctx.fillStyle = '#27ae60';
}

// Desenhar fundo
function drawBackground() {
    if (bgNeedsUpdate) renderBackgroundBuffer();
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
}

// Verificar colisões
function checkCollisions() {
    // Colisão com o chão ou teto
    if (game.penguin.y + game.penguin.height > canvas.height || game.penguin.y < 0) {
        return true;
    }
    
    // Colisão com canos
    for (let pipe of game.pipes) {
        if (game.penguin.x + game.penguin.width > pipe.x && 
            game.penguin.x < pipe.x + PIPE_WIDTH) {
            
            if (game.penguin.y < pipe.topHeight || 
                game.penguin.y + game.penguin.height > pipe.bottomY) {
                return true;
            }
        }
    }
    
    return false;
}

// Enviar estado do jogo para o servidor
function sendGameState() {
    if (game.gameRunning) {
        const gameState = {
            penguin: {
                x: game.penguin.x,
                y: game.penguin.y,
                width: game.penguin.width,
                height: game.penguin.height,
                velocity: game.penguin.velocity
            },
            pipes: game.pipes.map(pipe => ({
                x: pipe.x,
                topHeight: pipe.topHeight,
                bottomY: pipe.bottomY,
                seq: pipe.seq
            })),
            score: game.score
            ,
            // incluir altura do canvas para permitir normalização de Y em outros clientes
            canvasHeight: canvas.height
            ,
            // enviar posição global X do jogador
            worldX: myWorldX
        };
        
        socket.emit('gameStateUpdate', gameState);
    }
}

// Atualizar jogo
function updateGame(dtScale, timestamp) {
    if (!game.gameRunning) return;

    // Atualizar pinguim (escala pela variação de tempo)
    game.penguin.velocity += game.penguin.gravity * dtScale;
    game.penguin.y += game.penguin.velocity * dtScale;

    // Atualizar worldX: o mundo se move para a esquerda na mesma velocidade dos canos
    myWorldX += PIPE_SPEED * dtScale;

    // Atualizar canos
    game.pipes.forEach((pipe, index) => {
        pipe.x -= PIPE_SPEED * dtScale;

        // Verificar se o pinguim alcançou o ponto médio do cano (tocar som no meio)
        if (!pipe.midPlayed && (game.penguin.x + game.penguin.width / 2) >= (pipe.x + PIPE_WIDTH / 2)) {
            pipe.midPlayed = true;
            // Tocar som ao atingir o centro do cano
            playPassSound();
        }

        // Verificar se passou pelo cano (pontuação)
        if (!pipe.passed && pipe.x + PIPE_WIDTH < game.penguin.x) {
            pipe.passed = true;
            game.score++;
            scoreElement.textContent = game.score;
            socket.emit('scoreUpdate', game.score);
        }

        // Remover canos que saíram da tela
        if (pipe.x + PIPE_WIDTH < 0) {
            game.pipes.splice(index, 1);
        }
    });

    // Gerar novos canos
    if (game.pipes.length === 0 || game.pipes[game.pipes.length - 1].x < canvas.width - 200) {
        generatePipe();
    }

    // Verificar colisões
    if (checkCollisions()) {
        gameOver();
    }

    // Enviar estado do jogo para espectadores: throttle por tempo (50ms)
    if (timestamp && (timestamp - lastStateSentAt) >= 50) {
        sendGameState();
        lastStateSentAt = timestamp;
    }
}

// Game Over
function gameOver() {
    game.gameRunning = false;
    finalScoreElement.textContent = game.score;
    gameOverScreen.classList.remove('hidden');
    
    socket.emit('gameOver', game.score);
}

// Desenhar tela inicial
function drawStartScreen() {
    // Desenhar fundo e pinguim primeiro (o texto ficará sobreposto)
    drawBackground();
    drawPenguin();

    // Painel translúcido atrás do texto para garantir legibilidade
    const boxWidth = Math.min(600, canvas.width);
    const boxHeight = 120;
    const boxX = (canvas.width - boxWidth) / 2;
    const boxY = (canvas.height / 2) - (boxHeight / 2) - 10;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    // Título e instruções por cima
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px Arial';
    ctx.fillText('🐧 Flappy Penguin', canvas.width/2, boxY + 42);
    ctx.font = '18px Arial';
    ctx.fillText('Clique na tela para começar!', canvas.width/2, boxY + 84);
    ctx.restore();
}

// Contador de frames para otimização
let frameCount = 0;
let lastTimestamp = null;
let lastStateSentAt = 0; // ms, throttle sending gameState to spectators

// Loop principal do jogo
function gameLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = (timestamp - lastTimestamp) / 1000; // seconds since last frame
    const dtScale = dt * 60; // 1 at ~60 FPS, >1 when FPS lower
    lastTimestamp = timestamp;

    frameCount++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!game.gameStarted) {
        drawStartScreen();
    } else {
        drawBackground();
        drawPipes();
        drawOtherPlayers();
        drawPenguin();
        updateGame(dtScale, timestamp);
    }

    requestAnimationFrame(gameLoop);
}

// Event listeners
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        jump();
    }
});

// Event listener para clique/toque com prevenção de comportamentos indesejados
canvas.addEventListener('click', (e) => {
    e.preventDefault();
    jump();
});

// Event listener para toque mobile
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    jump();
}, { passive: false });

restartBtn.addEventListener('click', () => {
    initGame();
});

menuBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
});

backBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
});

// Inicializar prevenções mobile
preventMobileBehaviors();

// Iniciar o loop do jogo
gameLoop();