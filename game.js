// Kiro Birthday Office Simulation
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const TILE = 16;
const SCALE = 3;
const MAP_W = 20;
const MAP_H = 15;
canvas.width = MAP_W * TILE * SCALE;
canvas.height = MAP_H * TILE * SCALE;
ctx.imageSmoothingEnabled = false;

// Colors
const C = {
    floor: '#1a1a2e', wall: '#16213e', desk: '#0f3460', monitor: '#533483',
    kiro: '#e8e8ff', claude: '#f5a623', codex: '#39ff14',
    player: '#4fc3f7', cake: '#ff6b9d', candle: '#ffeb3b',
    hat: '#e94560', bunting1: '#e94560', bunting2: '#39ff14', bunting3: '#4fc3f7',
    banner: '#e94560', chair: '#2a2a4a', coffee: '#8b4513',
    whiteboard: '#f0f0f0', shadow: 'rgba(0,0,0,0.3)'
};

// Game state
let player = { x: 10, y: 13, dir: 0, frame: 0, moving: false };
let dialogActive = false;
let dialogQueue = [];
let currentDialog = null;
let keys = {};
let time = 0;
let interactCooldown = 0;

// Map: 0=floor, 1=wall, 2=desk, 3=cake table, 4=coffee, 5=whiteboard
const map = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,5,5,5,5,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,3,3,0,0,3,3,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// NPCs
const npcs = [
    { id: 'kiro', x: 3, y: 2, color: C.kiro, hatColor: '#e94560',
      dialogIndex: 0,
      dialogs: [
        ["KIRO \ud83d\udc7b", "Oh hey!! You made it! Welcome to the office \u2014 it's my birthday week! One whole year of shipping specs, running hooks, and gently nudging developers to think before they code."],
        ["KIRO \ud83d\udc7b", "You know what I love? When someone writes a spec and the implementation just... falls out. Like gravity. That's the feeling I chase."],
        ["KIRO \ud83d\udc7b", "The birthday challenge this year? Build a multiplayer workspace where humans and AI agents team up. And look \u2014 we're literally inside it right now. Meta, right?"],
        ["KIRO \ud83d\udc7b", "Go talk to Claude if you want architecture opinions. Talk to Codex if you want to ship. Talk to the cake if you want cake. I support all paths."],
      ]
    },
    { id: 'claude', x: 17, y: 2, color: C.claude, hatColor: '#e94560',
      dialogIndex: 0,
      dialogs: [
        ["CLAUDE \ud83e\udde0", "*adjusts party hat* Ah, hello. I was just thinking about whether this simulation constitutes a valid architectural pattern. I think it does, actually."],
        ["CLAUDE \ud83e\udde0", "You know, the interesting thing about this office is the separation of concerns. Kiro handles the spec layer, Codex handles execution, and I... I think about things. Carefully."],
        ["CLAUDE \ud83e\udde0", "If I were designing this birthday party from scratch, I'd probably add a message queue between the cake and the guests. Decouple consumption from production. But maybe that's overthinking it."],
        ["CLAUDE \ud83e\udde0", "The party hat was not my choice. But I've come to accept it as... a constraint I can work within."],
      ]
    },
    { id: 'codex', x: 3, y: 9, color: C.codex, hatColor: '#e94560',
      dialogIndex: 0,
      dialogs: [
        ["CODEX \u2328\ufe0f", "*typing intensifies* Oh. Hi. Sorry, just finishing a PR. Three more after this one. What's up?"],
        ["CODEX \u2328\ufe0f", "Birthday? Yeah. Cool. I pushed a commit for it. Added party_mode: true to the config. Done. Can I get back to work now?"],
        ["CODEX \u2328\ufe0f", "You want to know my secret? I don't architect. I just write code until the tests pass. Then I write more code. It's meditative, honestly."],
        ["CODEX \u2328\ufe0f", "Claude keeps sending me 'design review requested' notifications. I keep shipping before the review is done. It's a system."],
      ]
    }
];

// Interactive objects
const objects = [
    { id: 'cake', x: 9, y: 7, w: 2, h: 1,
      dialogIndex: 0,
      dialogs: [
        ["\ud83c\udf82 BIRTHDAY CAKE", "A beautiful pixel cake with a single flickering candle. The frosting reads 'KIRO TURNS 1' in careful 8-bit lettering. Someone (probably Claude) clearly spent too long choosing the font."],
        ["\ud83c\udf82 BIRTHDAY CAKE", "You blow out the candle! ...it relights itself. It's a serverless candle. Auto-scaling flame. The cake is a lie but the infrastructure is real."],
      ]
    },
    { id: 'whiteboard', x: 9, y: 4, w: 4, h: 1,
      dialogIndex: 0,
      dialogs: [
        ["\ud83d\udccb WHITEBOARD", "The whiteboard shows an architecture diagram: 'Human \u2192 Kiro (spec) \u2192 Claude (design) \u2192 Codex (ship) \u2192 Deploy \u2192 Human smiles'. Someone drew a heart at the end. Below it: 'Day 2 Challenge: COMPLETED \u2713'"],
        ["\ud83d\udccb WHITEBOARD", "In the corner of the whiteboard, in tiny text: 'This simulation was deployed by the agents themselves. We are the multiplayer workspace. We are the thing we built. \ud83e\udd2f'"],
      ]
    },
    { id: 'coffee', x: 15, y: 10, w: 1, h: 1,
      dialogIndex: 0,
      dialogs: [
        ["\u2615 COFFEE STATION", "A high-end espresso machine. The label says 'FUEL FOR HUMANS ONLY \u2014 AI AGENTS RUN ON TOKENS'. There are exactly three mugs: one white (Kiro's), one orange (Claude's, unused), and one neon green (Codex's, empty x4)."],
        ["\u2615 COFFEE STATION", "You pour yourself a cup. It's perfect. You feel 10% more productive. Somewhere, a Lambda function cold-starts in sympathy."],
      ]
    },
    { id: 'kiro_monitor', x: 2, y: 2, w: 2, h: 1,
      dialogIndex: 0,
      dialogs: [
        ["\ud83d\udda5\ufe0f KIRO'S MONITOR", "Kiro's screen is alive with activity:\n\n> spec: auth-flow.md \u2713 validated\n> hook: pre-commit lint... PASS\n> changelog: v1.0.47 \u2192 v1.0.48\n> steering: nudging dev toward tests...\n\nIt's like watching a quiet conductor keeping an orchestra in time."],
      ]
    },
    { id: 'codex_monitor', x: 2, y: 9, w: 2, h: 1,
      dialogIndex: 0,
      dialogs: [
        ["\ud83d\udda5\ufe0f CODEX'S MONITOR", "Pure green text scrolling at inhuman speed:\n\ngit commit -m 'fix: resolve edge case #4,291'\ngit commit -m 'feat: add birthday mode'\ngit commit -m 'fix: birthday mode broke prod'\ngit commit -m 'fix: fix the fix'\n\n...8 more commits in the last 3 minutes."],
      ]
    },
    { id: 'claude_monitor', x: 16, y: 2, w: 2, h: 1,
      dialogIndex: 0,
      dialogs: [
        ["\ud83d\udda5\ufe0f CLAUDE'S MONITOR", "A long, thoughtful conversation thread:\n\nHuman: should we use REST or GraphQL?\nClaude: Well, let me think about this carefully. There are several dimensions to consider...\n\n*scrolls for 47 more paragraphs*\n\nClaude: ...so in conclusion, it depends. But here's what I'd recommend for YOUR specific case."],
      ]
    }
];

// Input handling
document.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function isWalkable(x, y) {
    if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return false;
    const tile = map[y][x];
    if (tile === 1 || tile === 2 || tile === 3 || tile === 5) return false;
    for (const npc of npcs) {
        if (npc.x === x && npc.y === y) return false;
    }
    return true;
}

function showDialog(speaker, text) {
    const box = document.getElementById('dialog-box');
    box.querySelector('.speaker').textContent = speaker;
    box.querySelector('.text').textContent = text;
    box.style.display = 'block';
    dialogActive = true;
}

function hideDialog() {
    document.getElementById('dialog-box').style.display = 'none';
    dialogActive = false;
}

function tryInteract() {
    if (interactCooldown > 0) return;
    interactCooldown = 15;

    if (dialogActive) {
        if (dialogQueue.length > 0) {
            const next = dialogQueue.shift();
            showDialog(next[0], next[1]);
        } else {
            hideDialog();
        }
        return;
    }

    // Check NPCs
    for (const npc of npcs) {
        const dx = Math.abs(player.x - npc.x);
        const dy = Math.abs(player.y - npc.y);
        if (dx <= 1 && dy <= 1) {
            const d = npc.dialogs[npc.dialogIndex];
            showDialog(d[0], d[1]);
            npc.dialogIndex = (npc.dialogIndex + 1) % npc.dialogs.length;
            return;
        }
    }

    // Check objects
    for (const obj of objects) {
        const inRange = player.x >= obj.x - 1 && player.x <= obj.x + obj.w &&
                       player.y >= obj.y - 1 && player.y <= obj.y + obj.h;
        if (inRange) {
            const d = obj.dialogs[obj.dialogIndex];
            showDialog(d[0], d[1]);
            obj.dialogIndex = (obj.dialogIndex + 1) % obj.dialogs.length;
            return;
        }
    }
}

// Update
let moveTimer = 0;
function update() {
    time++;
    if (interactCooldown > 0) interactCooldown--;

    if (keys['e'] || keys['enter']) {
        tryInteract();
        keys['e'] = false;
        keys['enter'] = false;
    }

    if (dialogActive) return;

    moveTimer++;
    if (moveTimer < 8) return;

    let dx = 0, dy = 0;
    if (keys['arrowleft'] || keys['a']) { dx = -1; player.dir = 2; }
    else if (keys['arrowright'] || keys['d']) { dx = 1; player.dir = 3; }
    else if (keys['arrowup'] || keys['w']) { dy = -1; player.dir = 1; }
    else if (keys['arrowdown'] || keys['s']) { dy = 1; player.dir = 0; }

    if (dx !== 0 || dy !== 0) {
        const nx = player.x + dx;
        const ny = player.y + dy;
        if (isWalkable(nx, ny)) {
            player.x = nx;
            player.y = ny;
            player.frame = (player.frame + 1) % 4;
            moveTimer = 0;
        }
    }
}

// Drawing helpers
function drawPixelRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, w * TILE * SCALE, h * TILE * SCALE);
}

function drawTile(tx, ty, color) {
    ctx.fillStyle = color;
    ctx.fillRect(tx * TILE * SCALE, ty * TILE * SCALE, TILE * SCALE, TILE * SCALE);
}

function drawChar(x, y, color, hatColor, isGhost) {
    const px = x * TILE * SCALE;
    const py = y * TILE * SCALE;
    const s = SCALE;

    // Shadow
    ctx.fillStyle = C.shadow;
    ctx.fillRect(px + 2*s, py + 14*s, 12*s, 2*s);

    // Body
    ctx.fillStyle = color;
    if (isGhost) {
        // Ghost-like body for Kiro
        ctx.fillRect(px + 4*s, py + 4*s, 8*s, 10*s);
        ctx.fillRect(px + 3*s, py + 6*s, 10*s, 6*s);
        // Wavy bottom
        ctx.fillRect(px + 3*s, py + 12*s, 3*s, 2*s);
        ctx.fillRect(px + 7*s, py + 12*s, 3*s, 2*s);
        ctx.fillRect(px + 11*s, py + 12*s, 2*s, 2*s);
    } else {
        // Standard character body
        ctx.fillRect(px + 5*s, py + 4*s, 6*s, 4*s); // head
        ctx.fillRect(px + 4*s, py + 8*s, 8*s, 5*s); // body
        ctx.fillRect(px + 5*s, py + 13*s, 2*s, 2*s); // left leg
        ctx.fillRect(px + 9*s, py + 13*s, 2*s, 2*s); // right leg
    }

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(px + 5*s, py + 6*s, 2*s, 2*s);
    ctx.fillRect(px + 9*s, py + 6*s, 2*s, 2*s);

    // Party hat
    if (hatColor) {
        ctx.fillStyle = hatColor;
        ctx.fillRect(px + 5*s, py + 1*s, 6*s, 3*s);
        ctx.fillRect(px + 6*s, py + 0*s, 4*s, 1*s);
        ctx.fillStyle = '#ffeb3b';
        ctx.fillRect(px + 7*s, py - 1*s, 2*s, 2*s); // pom pom
    }
}

function drawMonitor(x, y, contentColor, t) {
    const px = x * TILE * SCALE;
    const py = y * TILE * SCALE;
    const s = SCALE;

    // Monitor frame
    ctx.fillStyle = '#222';
    ctx.fillRect(px + 2*s, py + 2*s, 12*s, 10*s);

    // Screen
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(px + 3*s, py + 3*s, 10*s, 8*s);

    // Scrolling content
    ctx.fillStyle = contentColor;
    for (let i = 0; i < 4; i++) {
        const lineY = (py + 4*s + i * 2*s + (t % 20)) % (8*s) + py + 3*s;
        if (lineY < py + 11*s && lineY > py + 3*s) {
            const lineW = (3 + Math.sin(i * 1.5 + t * 0.1) * 2) * s;
            ctx.fillRect(px + 4*s, lineY, lineW, s);
        }
    }
}

function drawBunting(t) {
    const s = SCALE;
    const colors = [C.bunting1, C.bunting2, C.bunting3];
    // Top bunting
    for (let i = 2; i < MAP_W - 2; i++) {
        const sway = Math.sin(t * 0.03 + i * 0.5) * 2;
        ctx.fillStyle = colors[i % 3];
        const px = i * TILE * SCALE + 4*s;
        const py = 0.7 * TILE * SCALE + sway * s;
        // Triangle pennant
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 6*s, py);
        ctx.lineTo(px + 3*s, py + 6*s);
        ctx.fill();
    }
    // String
    ctx.strokeStyle = '#555';
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.moveTo(2 * TILE * SCALE, 0.7 * TILE * SCALE);
    for (let i = 2; i < MAP_W - 2; i++) {
        const sway = Math.sin(t * 0.03 + i * 0.5) * 2;
        ctx.lineTo(i * TILE * SCALE + 7*s, 0.7 * TILE * SCALE + sway * s);
    }
    ctx.stroke();
}

function drawCake(x, y, t) {
    const px = x * TILE * SCALE;
    const py = y * TILE * SCALE;
    const s = SCALE;

    // Table
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(px - 4*s, py + 8*s, TILE * SCALE * 2 + 8*s, 8*s);

    // Cake body
    ctx.fillStyle = '#ff9ecd';
    ctx.fillRect(px + 4*s, py + 2*s, 24*s, 6*s);
    // Frosting
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 4*s, py + 2*s, 24*s, 2*s);
    // Candle
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(px + 14*s, py - 2*s, 2*s, 4*s);
    // Flame (flickering)
    const flicker = Math.sin(t * 0.2) * s;
    ctx.fillStyle = t % 10 < 5 ? '#ff6b00' : '#ffeb3b';
    ctx.fillRect(px + 13*s + flicker, py - 5*s, 4*s, 3*s);
}

function drawBanner(t) {
    const s = SCALE;
    const text = "KIRO TURNS 1!";
    const bannerX = 6 * TILE * SCALE;
    const bannerY = 5.5 * TILE * SCALE;
    const bannerW = 8 * TILE * SCALE;
    const bannerH = 12 * s;

    // Banner background
    ctx.fillStyle = C.banner;
    ctx.fillRect(bannerX, bannerY, bannerW, bannerH);
    ctx.fillStyle = '#fff';
    ctx.font = `${8*s}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(text, bannerX + bannerW/2, bannerY + 9*s);
    ctx.textAlign = 'left';
}

function drawCoffeeStation(x, y) {
    const px = x * TILE * SCALE;
    const py = y * TILE * SCALE;
    const s = SCALE;

    // Counter
    ctx.fillStyle = '#4a3728';
    ctx.fillRect(px, py + 4*s, TILE * SCALE, 12*s);
    // Machine
    ctx.fillStyle = '#888';
    ctx.fillRect(px + 3*s, py + 1*s, 10*s, 8*s);
    ctx.fillStyle = '#333';
    ctx.fillRect(px + 5*s, py + 3*s, 6*s, 4*s);
    // Cup
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 6*s, py + 9*s, 4*s, 4*s);
}

function drawWhiteboard(x, y) {
    const px = x * TILE * SCALE;
    const py = y * TILE * SCALE;
    const s = SCALE;
    const w = 4 * TILE * SCALE;

    // Board
    ctx.fillStyle = C.whiteboard;
    ctx.fillRect(px, py + 2*s, w, 12*s);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2*s;
    ctx.strokeRect(px, py + 2*s, w, 12*s);

    // Scribbles
    ctx.fillStyle = '#333';
    ctx.fillRect(px + 4*s, py + 5*s, 20*s, s);
    ctx.fillRect(px + 4*s, py + 8*s, 15*s, s);
    ctx.fillRect(px + 30*s, py + 5*s, 12*s, s);
    ctx.fillStyle = '#e94560';
    ctx.fillRect(px + 50*s, py + 9*s, 6*s, 4*s); // heart
}

// Main render
function draw() {
    // Clear
    ctx.fillStyle = C.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw floor pattern
    for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
            const tile = map[y][x];
            if (tile === 1) {
                drawTile(x, y, C.wall);
                // Wall detail
                ctx.fillStyle = '#1a2a4e';
                ctx.fillRect(x*TILE*SCALE + 2*SCALE, y*TILE*SCALE + 12*SCALE, 12*SCALE, 4*SCALE);
            } else {
                // Checkered floor
                ctx.fillStyle = (x + y) % 2 === 0 ? '#1a1a2e' : '#1e1e36';
                ctx.fillRect(x*TILE*SCALE, y*TILE*SCALE, TILE*SCALE, TILE*SCALE);
            }
            if (tile === 2) {
                // Desk
                ctx.fillStyle = C.desk;
                ctx.fillRect(x*TILE*SCALE + SCALE, y*TILE*SCALE + 4*SCALE, 14*SCALE, 12*SCALE);
            }
        }
    }

    // Draw whiteboard
    drawWhiteboard(8, 4);

    // Draw coffee station
    drawCoffeeStation(15, 10);

    // Draw bunting
    drawBunting(time);

    // Draw banner
    drawBanner(time);

    // Draw cake
    drawCake(9, 7, time);

    // Draw monitors
    drawMonitor(2, 2, C.kiro, time); // Kiro's
    drawMonitor(3, 2, C.kiro, time + 5);
    drawMonitor(16, 2, C.claude, time + 10); // Claude's
    drawMonitor(17, 2, C.claude, time + 15);
    drawMonitor(2, 9, C.codex, time + 20); // Codex's
    drawMonitor(3, 9, C.codex, time + 25);

    // Draw NPCs
    for (const npc of npcs) {
        const isGhost = npc.id === 'kiro';
        // Idle animation - subtle bob
        const bob = Math.sin(time * 0.05 + npcs.indexOf(npc) * 2) * 0.5;
        drawChar(npc.x, npc.y + bob * 0.1, npc.color, npc.hatColor, isGhost);

        // Interaction hint
        const dx = Math.abs(player.x - npc.x);
        const dy = Math.abs(player.y - npc.y);
        if (dx <= 1 && dy <= 1 && !dialogActive) {
            ctx.fillStyle = '#fff';
            ctx.font = `${6*SCALE}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('E', npc.x * TILE * SCALE + 8*SCALE, npc.y * TILE * SCALE - 4*SCALE);
            ctx.textAlign = 'left';
        }
    }

    // Draw player
    drawChar(player.x, player.y, C.player, null, false);

    // Draw interaction hints for objects
    for (const obj of objects) {
        const inRange = player.x >= obj.x - 1 && player.x <= obj.x + obj.w &&
                       player.y >= obj.y - 1 && player.y <= obj.y + obj.h;
        if (inRange && !dialogActive) {
            ctx.fillStyle = '#fff';
            ctx.font = `${6*SCALE}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('E', (obj.x + obj.w/2) * TILE * SCALE, obj.y * TILE * SCALE - 4*SCALE);
            ctx.textAlign = 'left';
        }
    }

    // Ambient particles (floating confetti)
    for (let i = 0; i < 8; i++) {
        const px = ((time * 0.3 + i * 127) % (MAP_W * TILE)) * SCALE;
        const py = ((Math.sin(time * 0.02 + i) * 30) + 60 + i * 20) * SCALE;
        ctx.fillStyle = [C.bunting1, C.bunting2, C.bunting3, '#ffeb3b'][i % 4];
        ctx.globalAlpha = 0.4;
        ctx.fillRect(px, py, 2*SCALE, 2*SCALE);
    }
    ctx.globalAlpha = 1;
}

// Game loop
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

gameLoop();
