// Configuração do jogo
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

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

const PIPE_WIDTH = 60;
const PIPE_GAP = 150;
const PIPE_SPEED = 2;

// Configurar jogador
const playerName = localStorage.getItem('playerName') || 'Pinguim Anônimo';
playerNameDisplay.textContent = `Jogador: ${playerName}`;

// Conectar ao servidor
socket.emit('playerJoin', playerName);

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
    generatePipe();
}

// Gerar canos
function generatePipe() {
    const minHeight = 50;
    const maxHeight = canvas.height - PIPE_GAP - minHeight;
    const topHeight = Math.random() * (maxHeight - minHeight) + minHeight;
    
    game.pipes.push({
        x: canvas.width,
        topHeight: topHeight,
        bottomY: topHeight + PIPE_GAP,
        passed: false
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

// Desenhar canos
function drawPipes() {
    ctx.fillStyle = '#27ae60';
    
    game.pipes.forEach(pipe => {
        // Cano superior
        ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
        
        // Cano inferior
        ctx.fillRect(pipe.x, pipe.bottomY, PIPE_WIDTH, canvas.height - pipe.bottomY);
        
        // Bordas dos canos
        ctx.fillStyle = '#229954';
        ctx.fillRect(pipe.x - 5, pipe.topHeight - 30, PIPE_WIDTH + 10, 30);
        ctx.fillRect(pipe.x - 5, pipe.bottomY, PIPE_WIDTH + 10, 30);
        ctx.fillStyle = '#27ae60';
    });
}

// Desenhar fundo
function drawBackground() {
    // Céu
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#74b9ff');
    gradient.addColorStop(1, '#0984e3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Nuvens simples
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(100, 100, 30, 0, Math.PI * 2);
    ctx.arc(120, 100, 40, 0, Math.PI * 2);
    ctx.arc(140, 100, 30, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(300, 150, 25, 0, Math.PI * 2);
    ctx.arc(315, 150, 35, 0, Math.PI * 2);
    ctx.arc(330, 150, 25, 0, Math.PI * 2);
    ctx.fill();
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
                bottomY: pipe.bottomY
            })),
            score: game.score
        };
        
        socket.emit('gameStateUpdate', gameState);
    }
}

// Atualizar jogo
function updateGame() {
    if (!game.gameRunning) return;
    
    // Atualizar pinguim
    game.penguin.velocity += game.penguin.gravity;
    game.penguin.y += game.penguin.velocity;
    
    // Atualizar canos
    game.pipes.forEach((pipe, index) => {
        pipe.x -= PIPE_SPEED;
        
        // Verificar se passou pelo cano
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
    
    // Enviar estado do jogo para espectadores (a cada 3 frames para otimizar)
    if (frameCount % 3 === 0) {
        sendGameState();
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
    drawBackground();
    
    // Título
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🐧 Flappy Penguin', canvas.width/2, canvas.height/2 - 50);
    
    // Instruções
    ctx.font = '18px Arial';
    ctx.fillText('Pressione ESPAÇO ou clique para começar!', canvas.width/2, canvas.height/2 + 20);
    
    // Pinguim na posição inicial
    drawPenguin();
}

// Contador de frames para otimização
let frameCount = 0;

// Loop principal do jogo
function gameLoop() {
    frameCount++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!game.gameStarted) {
        drawStartScreen();
    } else {
        drawBackground();
        drawPipes();
        drawPenguin();
        updateGame();
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