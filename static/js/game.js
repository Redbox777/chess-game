var board = null;
var game = new Chess();
var socket = null;
var room = null;
var username = null;
var playerColor = 'w';
var stockfish = null;

console.log('game.js загружен');

$(document).ready(function() {
    console.log('DOM готов');
    
    var pathParts = window.location.pathname.split('/');
    room = pathParts[pathParts.length - 1] || 'default';
    console.log('Комната:', room);
    
    $('#join-btn').on('click', function() {
        console.log('Кнопка нажата');
        username = $('#username').val().trim();
        console.log('Имя:', username);
        
        if (username) {
            console.log('Показываем игру');
            $('#login-form').hide();
            $('#game-area').show();
            $('#room-info').text('Комната: ' + room);
            initGame();
        } else {
            alert('Введите имя!');
        }
    });
});

function initGame() {
    console.log('Инициализация игры...');
    
    try {
        socket = io();
        console.log('Socket.IO подключен');
        
        var config = {
            draggable: true,
            position: 'start',
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd
        };
        
        board = Chessboard('board', config);
        console.log('Доска создана');
        
        // Инициализация Stockfish
        if (typeof Worker !== 'undefined') {
            stockfish = new Worker('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js');
            stockfish.onmessage = function(event) {
                var message = event.data;
                if (message.startsWith('bestmove')) {
                    var bestMove = message.split(' ')[1];
                    showHint(bestMove);
                }
            };
        }
        
        socket.emit('join', { room: room, username: username });
        console.log('Присоединился к комнате');
        
        socket.on('board_state', function(data) {
            console.log('Получено состояние доски:', data.fen);
            game.load(data.fen);
            board.position(data.fen);
            if (data.players.length > 1 && data.players[0] === username) {
                playerColor = 'b';
                board.orientation('black');
            }
        });
        
        socket.on('move_made', function(data) {
            game.load(data.fen);
            board.position(data.fen);
            $('#hint-text').text('');
        });
        
        socket.on('chat_message', function(data) {
            $('#chat-messages').append($('<div>').text(data.username + ': ' + data.text));
            $('#chat-messages')[0].scrollTop = $('#chat-messages')[0].scrollHeight;
        });
        
        socket.on('message', function(data) {
            $('#chat-messages').append($('<div class="system">').text(data.text));
        });
        
        $('#hint-btn').on('click', function() {
            if (game.turn() !== playerColor) {
                $('#hint-text').text('Сейчас не ваш ход!');
                return;
            }
            $('#hint-text').text('Анализирую...');
            stockfish.postMessage('position fen ' + game.fen());
            stockfish.postMessage('go depth 10');
        });
        
        $('#send-chat').on('click', function() {
            var text = $('#chat-text').val().trim();
            if (text && socket) {
                socket.emit('chat', { room: room, username: username, text: text });
                $('#chat-text').val('');
            }
        });
        
        $(window).resize(board.resize);
        
        console.log('Инициализация завершена!');
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        alert('Ошибка: ' + error.message);
    }
}

function showHint(bestMove) {
    if (!bestMove || bestMove.length < 4) {
        $('#hint-text').text('Не удалось найти подсказку');
        return;
    }
    
    var from = bestMove.substring(0, 2);
    var to = bestMove.substring(2, 4);
    
    $('.square-' + from).css('background-color', '#ffff00');
    $('.square-' + to).css('background-color', '#90EE90');
    
    setTimeout(function() {
        $('.square-' + from).css('background-color', '');
        $('.square-' + to).css('background-color', '');
    }, 3000);
    
    $('#hint-text').text('Рекомендуемый ход: ' + from + '-' + to);
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
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
}

function onSnapEnd() {
    board.position(game.fen());
}
