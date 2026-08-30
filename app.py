from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import uuid

app = Flask(__name__)
app.config["SECRET_KEY"] = "chess_secret_key"
socketio = SocketIO(app, cors_allowed_origins="*")

rooms = {}

@app.route('/')
def index():
    # Создаем новую комнату и перенаправляем
    room_id = str(uuid.uuid4())[:8]
    return redirect(url_for('room', room_id=room_id))

@app.route('/room/<room_id>')
def room(room_id):
    return render_template('index.html', room_id=room_id)

@socketio.on("join")
def on_join(data):
    room_id = data["room"]
    username = data["username"]
    join_room(room_id)
    if room_id not in rooms:
        rooms[room_id] = {"players": [], "board": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}
    if username not in rooms[room_id]["players"]:
        rooms[room_id]["players"].append(username)
    emit("message", {"text": f"{username} присоединился к комнате"}, room=room_id)
    emit("board_state", {"fen": rooms[room_id]["board"], "players": rooms[room_id]["players"]}, room=room_id)

@socketio.on("leave")
def on_leave(data):
    room_id = data["room"]
    username = data["username"]
    leave_room(room_id)
    if room_id in rooms and username in rooms[room_id]["players"]:
        rooms[room_id]["players"].remove(username)
    emit("message", {"text": f"{username} покинул комнату"}, room=room_id)

@socketio.on("move")
def on_move(data):
    room_id = data["room"]
    if room_id in rooms:
        rooms[room_id]["board"] = data["fen"]
    emit("move_made", {"fen": data["fen"], "from": data["from"], "to": data["to"]}, room=room_id, skip_sid=data.get("sid"))

@socketio.on("chat")
def on_chat(data):
    room_id = data["room"]
    emit("chat_message", {"username": data["username"], "text": data["text"]}, room=room_id)

if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
