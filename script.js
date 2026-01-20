// Firebase config (punyamu)
const firebaseConfig = {
  apiKey: "AIzaSyATUXGcxuwMZBshlEoZO0LJE_EB5Ac8Vjo",
  authDomain: "uno-71.firebaseapp.com",
  databaseURL: "https://uno-71-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "uno-71",
  storageBucket: "uno-71.firebasestorage.app",
  messagingSenderId: "938747567207",
  appId: "1:938747567207:web:354974a278236f30fe88c2"
};

// Init Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== MULTIPLAYER ROOM =====
let roomCode = null;
let playerName = "Player-" + Math.floor(Math.random() * 1000);
let isOwner = false;

function hideAll(){
  document.querySelectorAll("div").forEach(d=>d.classList.add("hide"));
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
  roomCode = Math.floor(100000 + Math.random()*900000);
  const max = document.getElementById("maxPlayer").value;
  isOwner = true;

  db.ref("rooms/" + roomCode).set({
    owner: playerName,
    max: max,
    players: [playerName],
    started: false
  });

  listenRoom();
  enterRoom();
}

function joinRoom(){
  roomCode = document.getElementById("roomInput").value;

  db.ref("rooms/" + roomCode).once("value", snap=>{
    if(!snap.exists()) return alert("Room tidak ditemukan");

    const data = snap.val();
    if(data.players.length >= data.max)
      return alert("Room penuh");

    data.players.push(playerName);
    db.ref("rooms/" + roomCode + "/players").set(data.players);

    listenRoom();
    enterRoom();
  });
}

function listenRoom(){
  db.ref("rooms/" + roomCode).on("value", snap=>{
    const data = snap.val();
    if(!data) return;

    document.getElementById("playerList").innerText =
      "Player: " + data.players.join(", ");

    if(data.started){
      alert("Game dimulai 🎴");
    }
  });
}

function enterRoom(){
  hideAll();
  document.getElementById("room").classList.remove("hide");
  document.getElementById("roomCode").innerText = roomCode;
}

function startGame(){
  if(!isOwner) return;
  db.ref("rooms/" + roomCode + "/started").set(true);
}
