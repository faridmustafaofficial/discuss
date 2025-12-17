const socket = io('/');
const myPeer = new Peer(undefined, {
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
});

// GLOBAL STATES
const peers = {}; // Call Objectləri
let myStream;
let myPeerId;
let currentRoom = null;
let isAdmin = false;
let isVideo = false;
let isScreen = false;
let isMuted = false;
let isDeaf = false;
let audioCtx;

// DOM ELEMENTLƏRİ
const views = {
    lobby: document.getElementById('lobby-screen'),
    room: document.getElementById('room-screen'),
    roomList: document.getElementById('rooms-list'),
    videoGrid: document.getElementById('video-grid'),
    chat: document.getElementById('chat-sidebar'),
    micSelect: document.getElementById('mic-select')
};

// 1. CİHAZLARI YÜKLƏ
async function initDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devs = await navigator.mediaDevices.enumerateDevices();
        views.micSelect.innerHTML = '';
        devs.filter(d => d.kind === 'audioinput').forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Mikrofon ${views.micSelect.length+1}`;
            views.micSelect.appendChild(opt);
        });
    } catch(e) { console.log("Mic icazəsi yoxdur"); }
}
initDevices();

// 2. SOCKET DINLƏYİCİLƏRİ
socket.on('room-list', renderRooms);
socket.on('room-created', id => joinRoom(id, document.getElementById('room-name').value));
socket.on('admin-status', s => isAdmin = s);
socket.on('receive-message', d => addMessage(d.user, d.msg, false));
socket.on('kicked', () => location.reload());
socket.on('user-disconnected', removeUser);
socket.on('participants', users => {
    users.forEach(u => {
        if(u.id !== myPeerId) addUserCard(u.id, u.name, false);
    });
});

socket.on('user-connected', (id, name) => {
    // Yeni gələnə zəng et
    connectToNewUser(id, name, myStream);
});

// PeerJS - Mənə zəng gələndə
myPeer.on('open', id => myPeerId = id);
myPeer.on('call', call => {
    call.answer(myStream);
    
    // Qarşı tərəfin stream-i gələndə
    call.on('stream', userStream => {
        addUserCard(call.peer, "User", false); // Kart yoxdursa yarat
        setRemoteStream(call.peer, userStream);
    });
    peers[call.peer] = call;
});


// 3. UI EVENTLƏRİ
document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-display').innerText = this.value;
}

document.getElementById('create-btn').onclick = () => {
    const user = document.getElementById('username').value;
    const name = document.getElementById('room-name').value;
    const pass = document.getElementById('room-pass').value;
    const limit = document.getElementById('limit-slider').value;
    
    if(!user || !name) return alert("Ad və Otaq adı vacibdir!");
    socket.emit('create-room', { user, name, pass, limit });
};

document.getElementById('leave-btn').onclick = () => location.reload();

// Chat Toggle
document.getElementById('chat-btn').onclick = () => {
    views.chat.classList.toggle('collapsed');
    document.getElementById('chat-badge').classList.add('hidden');
};
document.getElementById('close-chat').onclick = () => views.chat.classList.add('collapsed');

// Mesaj Göndər
document.getElementById('send-msg').onclick = sendMessage;
document.getElementById('chat-input').onkeypress = e => { if(e.key==='Enter') sendMessage() };

function sendMessage() {
    const inp = document.getElementById('chat-input');
    const txt = inp.value.trim();
    if(!txt) return;
    const user = document.getElementById('username').value;
    addMessage(user, txt, true);
    socket.emit('send-message', txt, currentRoom, user);
    inp.value = '';
}

// Media Butonları
document.getElementById('mic-btn').onclick = toggleMic;
document.getElementById('deaf-btn').onclick = toggleDeaf;
document.getElementById('cam-btn').onclick = toggleCam;
document.getElementById('screen-btn').onclick = toggleScreen;


// 4. CORE FUNKSİYALAR (Join & Stream)

// Otaq Siyahısını Çək
function renderRooms(rooms) {
    views.roomList.innerHTML = '';
    Object.values(rooms).forEach(r => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <div>
                <div class="room-name">${r.name} ${r.hasPass ? '<i class="fa-solid fa-lock"></i>' : ''}</div>
                <div class="room-meta"><i class="fa-solid fa-users"></i> ${r.count}/${r.limit}</div>
            </div>
            <button class="join-btn" onclick="preJoin('${r.id}', '${r.name}', ${r.hasPass})">GİR</button>
        `;
        views.roomList.appendChild(div);
    });
}

// Giriş Yoxlanışı
let tempJoinId = null;
window.preJoin = (id, name, hasPass) => {
    const user = document.getElementById('username').value;
    if(!user) return alert("Zəhmət olmasa adınızı yazın!");
    
    if(hasPass) {
        tempJoinId = id;
        document.getElementById('password-modal').classList.remove('hidden');
    } else {
        joinRoom(id, name);
    }
};

document.getElementById('modal-confirm').onclick = () => {
    const pass = document.getElementById('modal-pass').value;
    socket.emit('check-room', tempJoinId, pass, res => {
        if(res.success) {
            document.getElementById('password-modal').classList.add('hidden');
            joinRoom(tempJoinId, "Room");
        } else alert(res.msg);
    });
};
document.getElementById('modal-cancel').onclick = () => document.getElementById('password-modal').classList.add('hidden');


// Otağa Daxil Ol
function joinRoom(id, name) {
    currentRoom = id;
    const user = document.getElementById('username').value;
    
    views.lobby.classList.add('hidden');
    views.room.classList.remove('hidden');
    document.getElementById('current-room-name').innerText = name;

    // Audio Context (Visualizer üçün)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Mikrofonu Aç
    const micId = views.micSelect.value;
    navigator.mediaDevices.getUserMedia({ 
        audio: { deviceId: micId ? { exact: micId } : undefined }, 
        video: false 
    }).then(stream => {
        myStream = stream;
        addUserCard(myPeerId, user, true); // Öz kartım
        
        // Serverə bildir
        socket.emit('join-room', id, myPeerId, user);
    });
}

// User Kartı Yarat (Video + Audio + Visualizer)
function addUserCard(id, name, isMe) {
    if(document.getElementById(`user-${id}`)) return;

    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `user-${id}`;
    
    let menuHtml = '';
    if(!isMe) {
        menuHtml = `<div class="menu-dots" onclick="toggleKickMenu('${id}')">⋮</div>
                    <div id="kick-${id}" class="kick-menu"><button class="kick-btn" onclick="kick('${id}')">Qov</button></div>`;
    }

    div.innerHTML = `
        <video id="vid-${id}" autoplay playsinline muted></video>
        <div id="av-${id}" class="avatar"><i class="fa-solid fa-microphone"></i></div>
        <div class="user-name">${name}</div>
        <canvas id="cvs-${id}" class="visualizer"></canvas>
        ${menuHtml}
    `;
    views.videoGrid.appendChild(div);

    if(isMe) {
        // Öz streamimi vizualizatora qoş
        attachVisualizer(myStream, document.getElementById(`cvs-${id}`));
    }
}

// Digər istifadəçiyə qoşul
function connectToNewUser(userId, userName, stream) {
    addUserCard(userId, userName, false);
    const call = myPeer.call(userId, stream);
    
    call.on('stream', userStream => {
        setRemoteStream(userId, userStream);
    });
    peers[userId] = call;
}

// Gələn stream-i elementə bağla
function setRemoteStream(id, stream) {
    const vid = document.getElementById(`vid-${id}`);
    const cvs = document.getElementById(`cvs-${id}`);
    if(vid) {
        vid.srcObject = stream;
        checkVideoState(stream, id);
        
        // Track dəyişəndə (ekran/kamera) yoxla
        stream.getVideoTracks()[0]?.addEventListener('mute', () => checkVideoState(stream, id));
        stream.getVideoTracks()[0]?.addEventListener('unmute', () => checkVideoState(stream, id));
        
        if(cvs) attachVisualizer(stream, cvs);
    }
}

// Video varmı yoxla (Avatar vs Video)
function checkVideoState(stream, id) {
    const track = stream.getVideoTracks()[0];
    const card = document.getElementById(`user-${id}`);
    if(track && track.enabled && track.readyState === 'live' && !track.muted) {
        card.classList.add('video-active');
    } else {
        card.classList.remove('video-active');
    }
}

// User çıxanda
function removeUser(id) {
    if(peers[id]) peers[id].close();
    const el = document.getElementById(`user-${id}`);
    if(el) el.remove();
}


// 5. MEDİA KONTROLLARI (Track Replacement Logic)

async function toggleCam() {
    if(isScreen) return alert("Əvvəlcə ekran paylaşımını dayandırın!");
    isVideo = !isVideo;
    
    const btn = document.getElementById('cam-btn');
    btn.classList.toggle('active', isVideo);

    if(isVideo) {
        const vStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        replaceTracks(vStream);
        document.getElementById(`vid-${myPeerId}`).srcObject = vStream;
        document.getElementById(`user-${myPeerId}`).classList.add('video-active');
    } else {
        revertToMic();
    }
}

async function toggleScreen() {
    if(isScreen) {
        // Stop
        isScreen = false;
        document.getElementById('screen-btn').classList.remove('active');
        if(isVideo) toggleCam(); // Videoya qayıt
        else revertToMic();
    } else {
        // Start
        try {
            const sStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            isScreen = true;
            document.getElementById('screen-btn').classList.add('active');
            
            replaceTracks(sStream);
            document.getElementById(`vid-${myPeerId}`).srcObject = sStream;
            document.getElementById(`user-${myPeerId}`).classList.add('video-active');

            // Brauzerdən dayandıranda
            sStream.getVideoTracks()[0].onended = () => document.getElementById('screen-btn').click();
        } catch(e) {}
    }
}

function toggleMic() {
    if(isDeaf) return;
    isMuted = !isMuted;
    myStream.getAudioTracks()[0].enabled = !isMuted;
    
    const btn = document.getElementById('mic-btn');
    if(isMuted) {
        btn.classList.add('off');
        btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    } else {
        btn.classList.remove('off');
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    }
}

function toggleDeaf() {
    isDeaf = !isDeaf;
    isMuted = isDeaf; // Qulaqlıq bağlananda mik də bağlanır
    myStream.getAudioTracks()[0].enabled = !isMuted;
    
    const dBtn = document.getElementById('deaf-btn');
    const mBtn = document.getElementById('mic-btn');
    
    dBtn.classList.toggle('off');
    mBtn.classList.toggle('off', isMuted);
    
    // Gələn səsləri bağla
    document.querySelectorAll('video').forEach(v => {
        if(v.id !== `vid-${myPeerId}`) v.muted = isDeaf;
    });
}

// Köməkçi: Stream-i Mikrofonla əvəz et
async function revertToMic() {
    const micId = views.micSelect.value;
    const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { deviceId: micId ? { exact: micId } : undefined }, 
        video: false 
    });
    replaceTracks(stream);
    document.getElementById(`user-${myPeerId}`).classList.remove('video-active');
}

// Köməkçi: Peer Connection-da Track-i dəyiş
function replaceTracks(newStream) {
    const vTrack = newStream.getVideoTracks()[0];
    const aTrack = newStream.getAudioTracks()[0];
    
    if(aTrack) aTrack.enabled = !isMuted;
    
    for(let id in peers) {
        const senderV = peers[id].peerConnection.getSenders().find(s => s.track?.kind === 'video');
        const senderA = peers[id].peerConnection.getSenders().find(s => s.track?.kind === 'audio');
        
        if(senderV && vTrack) senderV.replaceTrack(vTrack);
        if(senderA && aTrack) senderA.replaceTrack(aTrack);
    }
    myStream = newStream;
    // Öz vizualizatorumu yenilə
    attachVisualizer(newStream, document.getElementById(`cvs-${myPeerId}`));
}


// 6. VISUALIZER & UI EXTRAS

function attachVisualizer(stream, canvas) {
    if(!audioCtx || !canvas) return;
    try {
        const src = audioCtx.createMediaStreamSource(stream);
        const anl = audioCtx.createAnalyser();
        src.connect(anl);
        anl.fftSize = 64;
        const len = anl.frequencyBinCount;
        const data = new Uint8Array(len);
        const ctx = canvas.getContext('2d');

        const draw = () => {
            requestAnimationFrame(draw);
            anl.getByteFrequencyData(data);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            let avg = 0;
            const width = canvas.width / len;
            let x = 0;
            
            for(let i=0; i<len; i++) {
                const h = (data[i] / 255) * canvas.height;
                ctx.fillStyle = '#3ba55c';
                ctx.fillRect(x, canvas.height - h, width, h);
                x += width;
                avg += data[i];
            }
            
            // Avatar "talking" effekti
            const userId = canvas.id.split('-')[1];
            const av = document.getElementById(`av-${userId}`);
            if(av) {
                if(avg/len > 10) av.classList.add('talking');
                else av.classList.remove('talking');
            }
        };
        draw();
    } catch(e) {}
}

// Kick Menu Logic
window.toggleKickMenu = (id) => {
    if(!isAdmin) return;
    const m = document.getElementById(`kick-${id}`);
    document.querySelectorAll('.kick-menu').forEach(x => {
        if(x !== m) x.style.display = 'none';
    });
    m.style.display = (m.style.display === 'block') ? 'none' : 'block';
};
window.kick = (id) => socket.emit('kick-user', id);

// Menyunu bağla
document.addEventListener('click', e => {
    if(!e.target.closest('.user-card')) {
        document.querySelectorAll('.kick-menu').forEach(m => m.style.display = 'none');
    }
});

function addMessage(user, msg, me) {
    const div = document.createElement('div');
    div.className = `msg ${me?'mine':''}`;
    div.innerHTML = `<b>${me?'':user}</b> ${msg}`;
    views.chat.querySelector('#chat-messages').appendChild(div);
    if(views.chat.classList.contains('collapsed')) 
        document.getElementById('chat-badge').classList.remove('hidden');
}
