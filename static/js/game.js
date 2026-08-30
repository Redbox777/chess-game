console.log('=== Chess Game Loaded ===');

var board = null;
var game = new Chess();
var socket = null;
var room = null;
var username = null;
var playerColor = 'w';
var stockfish = null;
var stockfishReady = false;

$(document).ready(function() {
    console.log('DOM ready');
    
    // Создаем комнату
    $('#create-room-btn').on('click', function() {
        username = prompt('Введите ваше имя:', 'Player' + Math.floor(Math.random() * 1000));
        if (username) {
            createRoom();
        }
    });
    
    // Войти в комнату
    $('#join-room-btn').on('click', function() {
        var roomCode = $('#room-code-input').val().trim();
        if (roomCode) {
            username = prompt('Введите ваше имя:', 'Player' + Math.floor(Math.random() * 1000));
            if (username) {
                joinExistingRoom(roomCode);
            }
        } else {
            alert('Введите код комнаты!');
        }
    });
});

function createRoom() {
    // Генерируем случайный код комнаты
    room = Math.random().toString(36).substring(2, 10).toUpperCase();
    startGame();
}

function joinExistingRoom(roomCode) {
    room = roomCode.toUpperCase();
    startGame();
}

function startGame() {
    $('#main-menu').hide();
    $('#game-screen').show();
    $('#room-code-display').text(room);
    
    initBoard();
    initSocket();
    initStockfish();
}

function initBoard() {
    console.log('Initializing board...');
    
    var config = {
        draggable: true,
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        onMouseoutSquare: onMouseoutSquare
    };
    
    board = Chessboard('board', config);
    console.log('Board initialized');
}

function initSocket() {
    console.log('Connecting to socket...');
    socket = io();
    
    socket.on('connect', function() {
        console.log('Socket connected');
        socket.emit('join', { room: room, username: username });
    });
    
    socket.on('board_state', function(data) {
        console.log('Received board state:', data);
        game.load(data.fen);
        board.position(data.fen);
        
        // Определяем цвет игрока
        if (data.players.length > 1) {
            if (data.players[0] === username) {
                playerColor = 'w';
                board.orientation('white');
                $('#white-player').text(username + ' (вы)');
                $('#black-player').text(data.players[1]);
            } else {
                playerColor = 'b';
                board.orientation('black');
                $('#black-player').text(username + ' (вы)');
                $('#white-player').text(data.players[0]);
            }
        } else {
            $('#white-player').text(username + ' (ожидание соперника...)');
            $('#black-player').text('Ожидание...');
        }
        
        $('#players-count').text('Игроков: ' + data.players.length + '/2');
    });
    
    socket.on('move_made', function(data) {
        console.log('Move made:', data);
        game.load(data.fen);
        board.position(data.fen);
        $('#hint-text').text('');
        updateStatus();
    });
    
    socket.on('chat_message', function(data) {
        addChatMessage(data.username, data.text);
    });
    
    socket.on('message', function(data) {
        addSystemMessage(data.text);
    });
    
    // Кнопка отправки чата
    $('#send-chat').on('click', sendChat);
    $('#chat-text').on('keypress', function(e) {
        if (e.which === 13) sendChat();
    });
    
    // Кнопка подсказки
    $('#hint-btn').on('click', getHint);
    
    // Кнопка копирования ссылки
    $('#copy-link-btn').on('click', function() {
        var url = window.location.origin + '/room/' + room;
        navigator.clipboard.writeText(url).then(function() {
            alert('Ссылка скопирована: ' + url);
        });
    });
}

function initStockfish() {
    console.log('Initializing Stockfish...');
    try {
        // Используем Stockfish через Web Worker
        stockfish = new Worker('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.0/stockfish.js');
        
        stockfish.onmessage = function(event) {
            var message = event.data;
            console.log('Stockfish:', message);
            
            if (message === 'readyok') {
                stockfishReady = true;
                console.log('Stockfish ready');
            }
            
            if (message.startsWith('bestmove')) {
                var bestMove = message.split(' ')[1];
                if (bestMove && bestMove !== '(none)') {
                    showHint(bestMove);
                } else {
                    $('#hint-text').text('Нет хороших ходов или мат!');
                }
            }
        };
        
        // Инициализация движка
        stockfish.postMessage('uci');
        stockfish.postMessage('isready');
        
    } catch (error) {
        console.error('Failed to load Stockfish:', error);
        $('#hint-text').text('Подсказки временно недоступны');
    }
}

function getHint() {
    if (!stockfish || !stockfishReady) {
        $('#hint-text').text('Загрузка движка...');
        return;
    }
    
    if (game.game_over()) {
        $('#hint-text').text('Игра закончена!');
        return;
    }
    
    if (game.turn() !== playerColor) {
        $('#hint-text').text('Сейчас не ваш ход!');
        return;
    }
    
    $('#hint-text').text('🤔 Анализирую позицию...');
    
    // Отправляем позицию на анализ
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth 8');
}

function showHint(bestMove) {
    var from = bestMove.substring(0, 2);
    var to = bestMove.substring(2, 4);
    var promotion = bestMove.substring(4, 5);
    
    // Подсветка клеток
    $('.square-' + from).addClass('highlight-from');
    $('.square-' + to).addClass('highlight-to');
    
    setTimeout(function() {
        $('.square-' + from).removeClass('highlight-from');
        $('.square-' + to).removeClass('highlight-to');
    }, 3000);
    
    var piece = game.get(from[0], parseInt(from[1]));
    var pieceName = getPieceName(piece.type);
    $('#hint-text').text('✓ ' + pieceName + ': ' + from.toUpperCase() + '-' + to.toUpperCase());
}

function getPieceName(type) {
    var names = {
        'p': 'Пешка',
        'n': 'Конь',
        'b': 'Слон',
        'r': 'Ладья',
        'q': 'Ферзь',
        'k': 'Король'
    };
    return names[type] || type;
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    
    // Можно двигать только свои фигуры
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
    
    // Можно двигать только в свой ход
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
}

function onDrop(source, target) {
    var move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });
    
    if (move === null) return 'snapback';
    
    board.position(game.fen());
    $('#hint-text').text('');
    
    if (socket) {
        socket.emit('move', {
            room: room,
            fen: game.fen(),
            from: source,
            to: target,
            sid: socket.id
        });
    }
    
    updateStatus();
}

function onSnapEnd() {
    board.position(game.fen());
}

function onMouseoutSquare(square) {
    // Убираем подсветку
    $('.square-' + square).removeClass('highlight-from highlight-to');
}

function sendChat() {
    var text = $('#chat-text').val().trim();
    if (text && socket) {
        socket.emit('chat', { room: room, username: username, text: text });
        $('#chat-text').val('');
    }
}

function addChatMessage(username, text) {
    var msg = $('<div>').html('<strong>' + username + '</strong>: ' + text);
    $('#chat-messages').append(msg);
    $('#chat-messages')[0].scrollTop = $('#chat-messages')[0].scrollHeight;
}

function addSystemMessage(text) {
    var msg = $('<div class="system">').text(text);
    $('#chat-messages').append(msg);
    $('#chat-messages')[0].scrollTop = $('#chat-messages')[0].scrollHeight;
}

function updateStatus() {
    var status = '';
    if (game.in_checkmate()) {
        status = 'Мат! Победа ' + (game.turn() === 'w' ? 'чёрных' : 'белых');
    } else if (game.in_draw()) {
        status = 'Ничья!';
    } else {
        status = (game.turn() === 'w' ? 'Ход белых' : 'Ход чёрных');
        if (game.in_check()) {
            status += ' (ШАХ!)';
        }
    }
    $('#status').text(status);
}

// Добавляем CSS для подсветки
$('<style>')
    .prop('type', 'text/css')
    .html('.square-55d63 { background: rgba(255, 255, 0, 0.5) !important; } .highlight-from { background: rgba(255, 255, 0, 0.8) !important; } .highlight-to { background: rgba(0, 255, 0, 0.8) !important; }')
    .appendTo('head');

console.log('=== Game Ready ===');
