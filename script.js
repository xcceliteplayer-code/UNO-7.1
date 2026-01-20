const colors = ["red","green","blue","yellow"];
const values = ["0","1","2","3","4","5","6","7","8","9","+2","skip","reverse"];
const wilds = ["wild","+4"];

let deck = [];
let player = [];
let bot = [];
let centerCard;

function createDeck() {
  deck = [];
  colors.forEach(c=>{
    values.forEach(v=>{
      deck.push({color:c,value:v});
    });
  });
  wilds.forEach(v=>{
    for(let i=0;i<4;i++) deck.push({color:"black",value:v});
  });
}

function shuffle() {
  deck.sort(()=>Math.random()-0.5);
}

function draw() {
  return deck.pop();
}

function startGame() {
  createDeck();
  shuffle();
  player = [];
  bot = [];
  for(let i=0;i<7;i++){
    player.push(draw());
    bot.push(draw());
  }
  centerCard = draw();
  render();
}

function render() {
  const p = document.getElementById("playerCards");
  p.innerHTML="";
  player.forEach((c,i)=>{
    const d=document.createElement("div");
    d.className=`card ${c.color}`;
    d.innerText=c.value;
    d.onclick=()=>playCard(i);
    p.appendChild(d);
  });

  const cc=document.getElementById("centerCard");
  cc.className=`card ${centerCard.color}`;
  cc.innerText=centerCard.value;

  document.getElementById("botCount").innerText=
    bot.length+" kartu";
}

function valid(card) {
  return card.color===centerCard.color ||
         card.value===centerCard.value ||
         card.color==="black";
}

function playCard(i) {
  const card = player[i];
  if(!valid(card)) return alert("Tidak cocok!");

  centerCard=card;
  player.splice(i,1);
  effect(card,"bot");
  botTurn();
  render();
}

function effect(card,target) {
  if(card.value==="+2") {
    for(let i=0;i<2;i++) target==="bot"?bot.push(draw()):player.push(draw());
  }
  if(card.value==="+4") {
    for(let i=0;i<4;i++) target==="bot"?bot.push(draw()):player.push(draw());
  }
}

function botTurn() {
  setTimeout(()=>{
    for(let i=0;i<bot.length;i++){
      if(valid(bot[i])){
        centerCard=bot[i];
        bot.splice(i,1);
        effect(centerCard,"player");
        render();
        return;
      }
    }
    bot.push(draw());
    render();
  },700);
}

function drawCard() {
  player.push(draw());
  render();
}

startGame();
