from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config["SECRET_KEY"] = "chess_secret_key_2024"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

rooms = {}   # { room_id: { players, board, minutes } }


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/room/<room_id>')
def room(room_id):
    return render_template('index.html', room_id=room_id)


# ── JOIN ─────────────────────────────────────────────────────────────────────
@socketio.on("join")
def on_join(data):
    room_id  = data["room"].upper().strip()
    username = data.get("username", "Игрок")
    minutes  = int(data.get("minutes", 5))

    join_room(room_id)

    if room_id not in rooms:
        rooms[room_id] = {
            "players": [],
            "board":   "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "minutes": minutes
        }

    room = rooms[room_id]

    if username not in room["players"]:
        room["players"].append(username)

    emit("chat_message", {
        "username": "Система",
        "text":     f"{username} присоединился к комнате",
        "system":   True
    }, to=room_id)

    # Если пришёл второй игрок — уведомляем первого
    if len(room["players"]) == 2:
        opponent = room["players"][0] if room["players"][1] == username else room["players"][1]
        emit("player_joined", {
            "opponent": username
        }, to=room_id)

    emit("board_state", {
        "fen":     room["board"],
        "players": room["players"],
        "minutes": room["minutes"]
    }, to=room_id)


# ── LEAVE ────────────────────────────────────────────────────────────────────
@socketio.on("leave")
def on_leave(data):
    room_id  = data["room"].upper().strip()
    username = data.get("username", "Игрок")
    leave_room(room_id)
    if room_id in rooms and username in rooms[room_id]["players"]:
        rooms[room_id]["players"].remove(username)
    emit("chat_message", {
        "username": "Система",
        "text":     f"{username} покинул комнату",
        "system":   True
    }, to=room_id)


# ── MOVE ─────────────────────────────────────────────────────────────────────
@socketio.on("move")
def on_move(data):
    room_id = data["room"].upper().strip()
    if room_id not in rooms:
        return
    rooms[room_id]["board"] = data["fen"]
    emit("move_made", {
        "fen":        data["fen"],
        "from":       data["from"],
        "to":         data["to"],
        "promotion":  data.get("promotion", "q"),
        "timeWhite":  data.get("timeWhite"),
        "timeBlack":  data.get("timeBlack")
    }, to=room_id, skip_sid=request.sid)


# ── CHAT ─────────────────────────────────────────────────────────────────────
@socketio.on("chat")
def on_chat(data):
    room_id  = data["room"].upper().strip()
    text     = data.get("text", "").strip()
    if not text:
        return
    emit("chat_message", {
        "username": data.get("username", "Игрок"),
        "text":     text,
        "system":   False
    }, to=room_id)


# ── RESIGN ────────────────────────────────────────────────────────────────────
@socketio.on("resign")
def on_resign(data):
    room_id  = data["room"].upper().strip()
    username = data.get("username", "Игрок")
    emit("opponent_resigned", {"username": username}, to=room_id)


# ── DRAW ─────────────────────────────────────────────────────────────────────
@socketio.on("draw_offer")
def on_draw_offer(data):
    room_id = data["room"].upper().strip()
    emit("draw_offered", {"username": data.get("username")},
         to=room_id, skip_sid=request.sid)

@socketio.on("draw_accept")
def on_draw_accept(data):
    room_id = data["room"].upper().strip()
    emit("draw_result", {}, to=room_id)

@socketio.on("draw_decline")
def on_draw_decline(data):
    room_id = data["room"].upper().strip()
    emit("draw_declined", {}, to=room_id, skip_sid=request.sid)


# ── TIME OUT ──────────────────────────────────────────────────────────────────
@socketio.on("time_out")
def on_time_out(data):
    room_id = data["room"].upper().strip()
    emit("time_out", {
        "loser":    data.get("loser"),
        "username": data.get("username")
    }, to=room_id)


# ── REMATCH ───────────────────────────────────────────────────────────────────
@socketio.on("rematch")
def on_rematch(data):
    room_id = data["room"].upper().strip()
    if room_id in rooms:
        rooms[room_id]["board"] = \
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    emit("rematch_start", {
        "minutes": rooms.get(room_id, {}).get("minutes", 5)
    }, to=room_id)


if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
