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

  const deck = createDeck();
  let gamePlayers = {};
  let turn = 0;

  db.ref("rooms/"+roomCode+"/players").once("value", snap=>{
    snap.val().forEach(p=>{
      gamePlayers[p] = deck.splice(0,7);
    });

    const center = deck.pop();

    db.ref("rooms/"+roomCode+"/game").set({
      deck: deck,
      centerCard: center,
      turn: turn,
      players: gamePlayers
    });

    db.ref("rooms/"+roomCode+"/started").set(true);
  });
}

const colors = ["red","green","blue","yellow"];
const values = ["0","1","2","3","4","5","6","7","8","9","+2","skip","reverse"];
const wilds = ["wild","+4"];

function createDeck(){
  let deck=[];
  colors.forEach(c=>{
    values.forEach(v=>{
      deck.push({color:c,value:v});
    });
  });
  wilds.forEach(v=>{
    for(let i=0;i<4;i++) deck.push({color:"black",value:v});
  });
  return deck.sort(()=>Math.random()-0.5);
}

db.ref("rooms/"+roomCode+"/game").on("value", snap=>{
  const game = snap.val();
  if(!game) return;

  renderGame(game);
});

function renderGame(game){
  document.getElementById("menu").classList.add("hide");
  document.getElementById("room").classList.add("hide");
  document.getElementById("game").classList.remove("hide");

  // kartu tengah
  const center = document.getElementById("centerCard");
  center.className = "card " + game.centerCard.color;
  center.innerText = game.centerCard.value;

  // kartu player
  const area = document.getElementById("playerCards");
  area.innerHTML = "";

  const myCards = game.players[playerName];
  if(!myCards) return;

  myCards.forEach((card, index)=>{
    const d = document.createElement("div");
    d.className = "card " + card.color;
    d.innerText = card.value;
    d.onclick = ()=> playCard(index, game);
    area.appendChild(d);
  });
}

  area.innerHTML = "<h3>Kartu Kamu</h3>";

  game.players[playerName]?.forEach(card=>{
    const d=document.createElement("div");
    d.className="card "+card.color;
    d.innerText=card.value;
    area.appendChild(d);
  });
}

function sendChat(){
  const msg = document.getElementById("chatInput").value;
  db.ref("rooms/"+roomCode+"/chat").push({
    name: playerName,
    msg: msg
  });
  document.getElementById("chatInput").value="";
}

db.ref("rooms/"+roomCode+"/chat").on("child_added", snap=>{
  const c=snap.val();
  document.getElementById("chatBox").innerHTML+=
    `<p><b>${c.name}</b>: ${c.msg}</p>`;
});

const playerRef = db.ref("rooms/"+roomCode+"/players");
playerRef.onDisconnect().once("value", snap=>{
  let arr=snap.val().filter(p=>p!==playerName);
  playerRef.set(arr);
});

function playCard(cardIndex, game){
  const myTurn = game.turn === Object.keys(game.players).indexOf(playerName);
  if(!myTurn) {
    alert("Bukan giliran kamu!");
    return;
  }

  const card = game.players[playerName][cardIndex];
  const center = game.centerCard;

  // validasi UNO dasar
  if(
    card.color !== center.color &&
    card.value !== center.value &&
    card.color !== "black"
  ){
    alert("Kartu tidak cocok!");
    return;
  }

  // buang kartu
  game.players[playerName].splice(cardIndex,1);
  game.centerCard = card;

  // giliran berikutnya
  const playerNames = Object.keys(game.players);
  game.turn = (game.turn + 1) % playerNames.length;

  // update firebase
  db.ref("rooms/"+roomCode+"/game").set(game);
}

db.ref("rooms/"+roomCode+"/game").on("value", snap=>{
  const game = snap.val();
  if(game) renderGame(game);
});
