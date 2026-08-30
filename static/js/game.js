/* =============================================
   Chess Online — game.js  (Этап 2: полная версия)
   Таймер | История ходов | Звуки | Анимации | Кнопки
   ============================================= */

// ── Globals ───────────────────────────────────────────────────────────────────
let board    = null;
let game     = new Chess();
let socket   = null;
let roomId   = null;
let username = null;
let myColor  = null;      // 'white' | 'black'
let isMyTurn = false;
let gameOver = false;
let selectedMinutes = 5; // выбранное время партии

// Таймеры (в секундах)
let timeWhite  = 0;
let timeBlack  = 0;
let timerInterval = null;

// История ходов
let moveHistory = [];   // массив строк SAN
let moveCount   = 0;

// Подсветка последнего хода
let lastMoveSquares = [];

// ── Звуки через Web Audio API (без CDN, без файлов) ──────────────────────────
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.3) {
    try {
        const ctx  = getAudioCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type      = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (e) { /* браузер заблокировал — молчим */ }
}

const sounds = {
    move:    () => playTone(440, 0.08, 'square', 0.2),
    capture: () => { playTone(300, 0.05, 'square', 0.25); playTone(200, 0.1, 'square', 0.2); },
    check:   () => { playTone(600, 0.1, 'sawtooth', 0.3); playTone(500, 0.15, 'sawtooth', 0.25); },
    checkmate: () => {
        [800, 600, 400, 300].forEach((f, i) =>
            setTimeout(() => playTone(f, 0.2, 'sawtooth', 0.35), i * 120));
    },
    draw:    () => { playTone(350, 0.2, 'sine', 0.25); playTone(350, 0.2, 'sine', 0.25); }
};

// ── DOM Ready ─────────────────────────────────────────────────────────────────
$(document).ready(function () {

    // ── Выбор времени ────────────────────────────────────────────────────────
    $('.time-btn').on('click', function () {
        $('.time-btn').removeClass('active');
        $(this).addClass('active');
        selectedMinutes = parseInt($(this).data('minutes'));
    });

    // ── Лобби ────────────────────────────────────────────────────────────────
    $('#btn-create').on('click', function () {
        $('#room-input').val(generateRoomCode());
        joinRoom();
    });

    $('#btn-join').on('click', joinRoom);
    $('#room-input, #username-input').on('keydown', function (e) {
        if (e.key === 'Enter') joinRoom();
    });

    // ── Управление доской ────────────────────────────────────────────────────
    $('#btn-flip').on('click', function () { board && board.flip(); });

    $('#btn-resign').on('click', function () {
        if (gameOver) return;
        if (!confirm('Вы уверены, что хотите сдаться?')) return;
        socket.emit('resign', { room: roomId, username });
    });

    $('#btn-draw').on('click', function () {
        if (gameOver) return;
        socket.emit('draw_offer', { room: roomId, username });
        showToast('Предложение ничьей отправлено');
    });

    $('#btn-hint').on('click', requestHint);

    // ── Ничья: принять / отклонить ───────────────────────────────────────────
    $('#btn-draw-accept').on('click', function () {
        socket.emit('draw_accept', { room: roomId });
        hideModal('modal-draw');
    });

    $('#btn-draw-decline').on('click', function () {
        socket.emit('draw_decline', { room: roomId, username });
        hideModal('modal-draw');
    });

    // ── Конец игры: реванш / лобби ───────────────────────────────────────────
    $('#btn-rematch').on('click', function () {
        socket.emit('rematch', { room: roomId, username });
        hideModal('modal-end');
        showToast('Запрос реванша отправлен…');
    });

    $('#btn-lobby').on('click', function () {
        location.reload();
    });

    // ── Чат ──────────────────────────────────────────────────────────────────
    $('#chat-send').on('click', sendChat);
    $('#chat-input').on('keydown', function (e) {
        if (e.key === 'Enter') sendChat();
    });
});

// ── Utils ─────────────────────────────────────────────────────────────────────
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function formatTime(sec) {
    if (sec < 0) sec = 0;
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ── Join Room ─────────────────────────────────────────────────────────────────
function joinRoom() {
    username = $('#username-input').val().trim();
    roomId   = $('#room-input').val().trim().toUpperCase();

    if (!username) { alert('Введите имя игрока'); return; }
    if (!roomId)   { alert('Введите код комнаты'); return; }

    $('#lobby-section').hide();
    $('#game-section').css('display', 'flex');
    $('#room-display').text(roomId);
    $('#player-name-display').text(username);

    connectSocket();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectSocket() {
    socket = io();

    socket.on('connect', function () {
        socket.emit('join', {
            room:     roomId,
            username: username,
            minutes:  selectedMinutes
        });
    });

    socket.on('disconnect', function () {
        appendChat('Система', 'Соединение прервано…', true);
    });

    // Состояние доски при входе
    socket.on('board_state', function (data) {
        const players = data.players || [];
        const idx = players.indexOf(username);
        myColor  = (idx === 1) ? 'black' : 'white';
        isMyTurn = (myColor === 'white');
        gameOver = false;

        // Имена игроков
        const isFlipped = (myColor === 'black');
        $('#player-bottom-name').text(username);
        $('#label-bottom').text(myColor === 'white' ? 'Белые ♔' : 'Чёрные ♚');

        const opponentName = players.find(p => p !== username) || 'Ожидаем…';
        $('#player-top-name').text(opponentName);
        $('#label-top').text(myColor === 'white' ? 'Чёрные ♚' : 'Белые ♔');

        // Таймеры
        const mins = data.minutes || selectedMinutes;
        timeWhite = mins * 60;
        timeBlack = mins * 60;
        updateTimerDisplay();

        // Инициализация доски
        initBoard(data.fen, isFlipped);
        clearMoveHistory();

        if (players.length < 2) {
            showStatus('Ожидаем второго игрока…');
            showToast('Код комнаты: ' + roomId);
        } else {
            startTimer();
            showStatus(isMyTurn ? '▶ Ваш ход' : '⏳ Ход соперника');
        }
    });

    // Второй игрок подключился
    socket.on('player_joined', function (data) {
        $('#player-top-name').text(data.opponent);
        startTimer();
        showStatus(isMyTurn ? '▶ Ваш ход' : '⏳ Ход соперника');
        appendChat('Система', `${data.opponent} присоединился. Игра началась!`, true);
    });

    // Ход соперника
    socket.on('move_made', function (data) {
        const move = game.move({
            from:      data.from,
            to:        data.to,
            promotion: data.promotion || 'q'
        });

        if (move) {
            board.position(game.fen());
            highlightMove(data.from, data.to);
            addMoveToHistory(move);

            // Синхронизируем таймеры с сервера
            if (data.timeWhite !== undefined) timeWhite = data.timeWhite;
            if (data.timeBlack !== undefined) timeBlack = data.timeBlack;
            updateTimerDisplay();
        }

        isMyTurn = true;
        updateGameStatus();
    });

    // Чат
    socket.on('chat_message', function (data) {
        appendChat(data.username, data.text, data.system || false);
    });

    // Сдача соперника
    socket.on('opponent_resigned', function (data) {
        endGame('🏆 Победа!', `${data.username} сдался.`, '🏆');
    });

    // Ничья принята
    socket.on('draw_result', function () {
        sounds.draw();
        endGame('½ Ничья', 'Игроки согласились на ничью.', '🤝');
    });

    // Нам предлагают ничью
    socket.on('draw_offered', function (data) {
        showModal('modal-draw');
    });

    // Соперник отклонил ничью
    socket.on('draw_declined', function () {
        showToast('Соперник отклонил ничью');
    });

    // Время вышло
    socket.on('time_out', function (data) {
        endGame(
            data.loser === username ? '⏰ Время вышло' : '🏆 Победа!',
            data.loser === username ? 'Ваше время истекло.' : 'Время соперника истекло.',
            data.loser === username ? '⏰' : '🏆'
        );
    });

    // Реванш
    socket.on('rematch_start', function (data) {
        hideModal('modal-end');
        game = new Chess();
        clearMoveHistory();
        gameOver = false;
        // Цвета меняются
        myColor  = myColor === 'white' ? 'black' : 'white';
        isMyTurn = (myColor === 'white');
        const mins = data.minutes || selectedMinutes;
        timeWhite = mins * 60;
        timeBlack = mins * 60;
        initBoard('start', myColor === 'black');
        startTimer();
        showStatus(isMyTurn ? '▶ Ваш ход' : '⏳ Ход соперника');
        appendChat('Система', 'Реванш! Начинаем заново.', true);
    });
}

// ── Board Init ────────────────────────────────────────────────────────────────
function initBoard(fen, flipped) {
    const cfg = {
        draggable:    true,
        position:     fen || 'start',
        orientation:  flipped ? 'black' : 'white',
        onDragStart:  onDragStart,
        onDrop:       onDrop,
        onSnapEnd:    onSnapEnd,
        pieceTheme:   'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        moveSpeed:    'fast',    // анимация ходов
        snapbackSpeed: 300,
        snapSpeed:     100
    };

    if (board) board.destroy();
    board = Chessboard('board', cfg);
    if (fen && fen !== 'start') game.load(fen);

    $(window).off('resize.chess').on('resize.chess', () => board.resize());
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function onDragStart(source, piece) {
    if (gameOver)   return false;
    if (!isMyTurn)  return false;
    if (!socket || !socket.connected) return false;
    if (myColor === 'white' && piece.search(/^b/) !== -1) return false;
    if (myColor === 'black' && piece.search(/^w/) !== -1) return false;

    // Подсвечиваем возможные ходы
    highlightLegalMoves(source);
}

function onDrop(source, target) {
    clearHighlights();

    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    // Звук
    if (move.captured) sounds.capture();
    else sounds.move();

    highlightMove(source, target);
    addMoveToHistory(move);

    isMyTurn = false;

    socket.emit('move', {
        room:       roomId,
        fen:        game.fen(),
        from:       source,
        to:         target,
        promotion:  'q',
        timeWhite:  timeWhite,
        timeBlack:  timeBlack
    });

    updateGameStatus();
}

function onSnapEnd() {
    board.position(game.fen());
}

// ── Highlights ────────────────────────────────────────────────────────────────
function highlightMove(from, to) {
    clearHighlights();
    lastMoveSquares = [from, to];
    [from, to].forEach(sq => {
        $(`[data-square="${sq}"]`).addClass('highlight-last');
    });
}

function highlightLegalMoves(square) {
    const moves = game.moves({ square, verbose: true });
    moves.forEach(m => {
        $(`[data-square="${m.to}"]`).addClass('highlight-dot');
    });
}

function clearHighlights() {
    $('.highlight-last, .highlight-dot, .highlight-check').removeClass(
        'highlight-last highlight-dot highlight-check'
    );
}

function highlightKingInCheck() {
    const color = game.turn();
    // Находим короля
    const pieces = game.board();
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = pieces[r][c];
            if (p && p.type === 'k' && p.color === color) {
                const files = 'abcdefgh';
                const sq = files[c] + (8 - r);
                $(`[data-square="${sq}"]`).addClass('highlight-check');
            }
        }
    }
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function tickTimer() {
    if (gameOver) { stopTimer(); return; }

    // Убываем у того, чей сейчас ход
    const whiteTurn = (game.turn() === 'w');
    if (whiteTurn) timeWhite--;
    else           timeBlack--;

    updateTimerDisplay();

    // Проверяем флаг
    if (timeWhite <= 0 || timeBlack <= 0) {
        stopTimer();
        const loser = timeWhite <= 0 ? 'white' : 'black';
        socket.emit('time_out', { room: roomId, loser, username });
    }
}

function updateTimerDisplay() {
    // Определяем кто вверху, кто внизу
    const myIsBottom  = true;
    const topIsWhite  = (myColor === 'black');

    const topTime     = topIsWhite  ? timeWhite : timeBlack;
    const bottomTime  = !topIsWhite ? timeWhite : timeBlack;

    $('#timer-top').text(formatTime(topTime));
    $('#timer-bottom').text(formatTime(bottomTime));

    // Класс low-time (< 30 сек) — мигает красным
    const $topBar    = $('#bar-opponent');
    const $bottomBar = $('#bar-me');

    $topBar.toggleClass('low-time',    topTime    < 30 && topTime    > 0);
    $bottomBar.toggleClass('low-time', bottomTime < 30 && bottomTime > 0);

    // Активный таймер (тикает у текущего игрока)
    const whiteTurn = (game.turn() === 'w');
    const myTurnNow = (myColor === 'white') ? whiteTurn : !whiteTurn;
    $topBar.toggleClass('active',    !myTurnNow);
    $bottomBar.toggleClass('active',  myTurnNow);
}

// ── Move History ──────────────────────────────────────────────────────────────
function addMoveToHistory(move) {
    moveHistory.push(move.san);
    renderMoveHistory();
}

function clearMoveHistory() {
    moveHistory = [];
    moveCount   = 0;
    $('#move-list').empty();
}

function renderMoveHistory() {
    const $list = $('#move-list');
    $list.empty();

    for (let i = 0; i < moveHistory.length; i += 2) {
        const num   = Math.floor(i / 2) + 1;
        const white = moveHistory[i]     || '';
        const black = moveHistory[i + 1] || '';

        const $row = $('<div class="move-row">');
        $row.append($('<span class="move-num">').text(num + '.'));
        $row.append($('<span class="move-white">').text(white).attr('data-idx', i));
        $row.append($('<span class="move-black">').text(black).attr('data-idx', i + 1));
        $list.append($row);
    }

    // Скролл вниз
    $list.scrollTop($list[0].scrollHeight);
}

// ── Game Status ───────────────────────────────────────────────────────────────
function updateGameStatus() {
    clearHighlights();

    if (game.isCheckmate()) {
        sounds.checkmate();
        const iWon = !isMyTurn;
        endGame(
            iWon ? '🏆 Победа!' : '💀 Поражение',
            iWon ? 'Вы поставили мат!' : 'Вам поставили мат.',
            iWon ? '🏆' : '💀'
        );
        return;
    }

    if (game.isDraw()) {
        sounds.draw();
        let reason = 'Ничья.';
        if (game.isStalemate())          reason = 'Пат.';
        if (game.isThreefoldRepetition()) reason = 'Троекратное повторение.';
        if (game.isInsufficientMaterial()) reason = 'Недостаточно материала.';
        endGame('½ Ничья', reason, '🤝');
        return;
    }

    if (game.isCheck()) {
        sounds.check();
        highlightKingInCheck();
        showStatus('⚠ Шах!', 'check');
    } else {
        showStatus(isMyTurn ? '▶ Ваш ход' : '⏳ Ход соперника');
    }
}

function showStatus(text, cls) {
    $('#status-bar').text(text).removeClass('check checkmate').addClass(cls || '');
}

// ── End Game ──────────────────────────────────────────────────────────────────
function endGame(title, body, emoji) {
    gameOver = true;
    stopTimer();

    $('#modal-end-title').text(title);
    $('#modal-end-body').text(body);
    $('#modal-end-emoji').text(emoji || '♟');
    showModal('modal-end');
    showStatus(title, title.includes('Победа') ? '' : 'checkmate');
}

// ── Modals ────────────────────────────────────────────────────────────────────
function showModal(id) { $('#' + id).addClass('active'); }
function hideModal(id) { $('#' + id).removeClass('active'); }

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
    const $t = $('#toast').text(msg).addClass('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $t.removeClass('show'), 3000);
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function sendChat() {
    const $input = $('#chat-input');
    const text   = $input.val().trim();
    if (!text || !socket) return;
    socket.emit('chat', { room: roomId, username, text });
    $input.val('').focus();
}

function appendChat(sender, text, isSystem) {
    const $msgs = $('#chat-messages');
    const $msg  = $('<div class="chat-msg">');
    if (isSystem) {
        $msg.addClass('system').text(text);
    } else {
        $msg.append($('<span class="sender">').text(sender + ':'), ' ' + text);
    }
    $msgs.append($msg);
    $msgs.scrollTop($msgs[0].scrollHeight);
}

// ── Stockfish Hint ────────────────────────────────────────────────────────────
function requestHint() {
    if (!isMyTurn || gameOver) {
        showToast('Подсказка доступна только в ваш ход');
        return;
    }
    $('#hint-text').text('Думаю…');

    // Используем простую оценку — лучший ход из chess.js
    // (настоящий Stockfish.js требует WebWorker — подключим отдельно)
    const moves = game.moves({ verbose: true });
    if (!moves.length) { $('#hint-text').text('Нет доступных ходов'); return; }

    // Простая эвристика: предпочитаем взятия, потом шахи, потом случайный
    let best = moves.find(m => m.flags.includes('c') && m.flags.includes('k')); // взятие с шахом
    if (!best) best = moves.find(m => m.flags.includes('k')); // шах
    if (!best) best = moves.find(m => m.captured);            // взятие
    if (!best) best = moves[Math.floor(Math.random() * moves.length)]; // случайный

    $('#hint-text').text(`${best.from} → ${best.to}  (${best.san})`);
    // Подсвечиваем подсказку
    clearHighlights();
    $(`[data-square="${best.from}"]`).addClass('highlight-last');
    $(`[data-square="${best.to}"]`).addClass('highlight-dot');
}
