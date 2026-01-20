let room = null;
let isOwner = false;
let playerName = "Player-" + Math.floor(Math.random()*1000);

function hideAll(){
  document.querySelectorAll("div").forEach(d=>d.classList.add("hide"));
}

function startBot(){
  alert("Bot vs Computer (nanti disambung ke game UNO)");
}

function openMultiplayer(){
  hideAll();
  document.getElementById("multiplayer").classList.remove("hide");
}

function showCreate(){
  hideAll();
  document.getElementById("create").classList.remove("hide");
}

function showJoin(){
  hideAll();
  document.getElementById("join").classList.remove("hide");
}

function createRoom(){
  const code = Math.floor(100000 + Math.random()*900000);
  const max = document.getElementById("maxPlayer").value;

  room = {
    code,
    max,
    players: [playerName],
    owner: playerName
  };

  localStorage.setItem("room_"+code, JSON.stringify(room));
  isOwner = true;
  enterRoom();
}

function joinRoom(){
  const code = document.getElementById("roomInput").value;
  const data = localStorage.getItem("room_"+code);
  if(!data) return alert("Room tidak ditemukan");

  room = JSON.parse(data);
  if(room.players.length >= room.max)
    return alert("Room penuh");

  room.players.push(playerName);
  localStorage.setItem("room_"+code, JSON.stringify(room));
  isOwner = false;
  enterRoom();
}

function enterRoom(){
  hideAll();
  document.getElementById("room").classList.remove("hide");
  document.getElementById("roomCode").innerText = room.code;
  updateRoom();
}

function updateRoom(){
  document.getElementById("playerList").innerText =
    "Player: " + room.players.join(", ");

  document.getElementById("startBtn").style.display =
    isOwner ? "inline-block" : "none";
}

function startGame(){
  alert("Owner memulai game 🎴");
}
