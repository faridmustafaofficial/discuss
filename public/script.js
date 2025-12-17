const socket = io('/');
const myPeer = new Peer(undefined, {
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
});

// Elementlər
const lobby = document.getElementById('lobby-container');
const roomDiv = document.getElementById('room-container');
const roomsList = document.getElementById('rooms-list');
const videoGrid = document.getElementById('video-grid');
const micSelect = document.getElementById('mic-select');
const passwordModal = document.getElementById('password-modal');

// Statuslar
const peers = {}; 
let myStream;
let currentRoomId = null;
let iamAdmin = false;
let isVideoOn = false;
let isScreenSharing = false;
let isMicMuted = false;
let isDeafened = false;
let audioContext; 

// Cihazları yüklə
async function getCameras() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        micSelect.innerHTML = '';
        inputs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Mic ${micSelect.length+1}`;
            micSelect.appendChild(opt);
        });
    } catch(e) {}
}
getCameras();

// --- BUTTON LOGIC ---

// Otaq Yarat
document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('room-name').value;
    const user = document.getElementById('username').value;
    const pass = document.getElementById('room-password').value;
    const limit = document.getElementById('limit-slider').value;
    if(name && user) socket.emit('create-room', { roomName: name, limit, username: user, password: pass });
};

// Slider UI
document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-val').innerText = this.value;
}

// Çıxış
document.getElementById('leave-btn').onclick = () => location.reload();

// KAMERA TOGGLE
document.getElementById('camera-btn').onclick = async () => {
    if(isScreenSharing) return alert("Əvvəlcə ekran paylaşımını dayandırın.");
    
    isVideoOn = !isVideoOn;
    const btn = document.getElementById('camera-btn');
    
    if(isVideoOn) {
        btn.classList.add('active-btn');
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        replaceStream(videoStream);
    } else {
        btn.classList.remove('active-btn');
        // Yalnız audioya qayıt
        const audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { deviceId: micSelect.value ? { exact: micSelect.value } : undefined }, 
            video: false 
        });
        replaceStream(audioStream);
    }
    // Özümüzdə videonu göstər/gizlət
    toggleLocalVideo(isVideoOn);
};

// EKRAN PAYLAŞIMI (Toggle)
document.getElementById('screen-share-btn').onclick = async () => {
    const btn = document.getElementById('screen-share-btn');
    const camBtn = document.getElementById('camera-btn');

    if(isScreenSharing) {
        // Stop Sharing
        isScreenSharing = false;
        btn.classList.remove('active-btn');
        
        // Əgər kamera açıq idisə kameraya qayıt, yoxsa sadəcə səsə
        if(isVideoOn) {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            replaceStream(videoStream);
            toggleLocalVideo(true);
        } else {
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { deviceId: micSelect.value ? { exact: micSelect.value } : undefined }, 
                video: false 
            });
            replaceStream(audioStream);
            toggleLocalVideo(false);
        }
    } else {
        // Start Sharing
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            isScreenSharing = true;
            btn.classList.add('active-btn');
            camBtn.classList.remove('active-btn'); // Kamera iconunu söndür (vizual)
            
            replaceStream(screenStream);
            toggleLocalVideo(true); // Ekranda göstər

            // Brauzerin öz "Stop" düyməsinə basanda
            screenStream.getVideoTracks()[0].onended = () => {
                document.getElementById('screen-share-btn').click();
            };
        } catch(e) {
            console.log("Ekran paylaşımı ləğv edildi");
        }
    }
};

// Stream dəyişmə funksiyası (Track replacement)
function replaceStream(newStream) {
    const videoTrack = newStream.getVideoTracks()[0];
    const audioTrack = newStream.getAudioTracks()[0];

    // Audio statusunu qoru
    if(audioTrack) audioTrack.enabled = !isMicMuted;

    for (let peerId in peers) {
        const sender = peers[peerId].peerConnection.getSenders().find(s => s.track.kind === 'video');
        if(sender && videoTrack) sender.replaceTrack(videoTrack);
        
        const audioSender = peers[peerId].peerConnection.getSenders().find(s => s.track.kind === 'audio');
        if(audioSender && audioTrack) audioSender.replaceTrack(audioTrack);
    }
    myStream = newStream;
}

// Öz video elementimizi idarə etmək
function toggleLocalVideo(show) {
    const myVid = document.getElementById(`video-${myPeer.id}`);
    const myAv = document.getElementById(`avatar-${myPeer.id}`);
    if(myVid && myAv) {
        if(show) {
            myVid.srcObject = myStream;
            myVid.style.display = 'block';
            myAv.style.display = 'none';
        } else {
            myVid.style.display = 'none';
            myAv.style.display = 'flex';
        }
    }
}


// --- SOCKET & ROOMS ---

socket.on('room-list', (rooms) => {
    roomsList.innerHTML = '';
    Object.values(rooms).forEach(r => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <div><b>${r.name}</b> ${r.hasPassword ? '<i class="fa-solid fa-lock"></i>' : ''}</div>
            <button class="join-btn" onclick="preJoin('${r.id}', '${r.name}', ${r.hasPassword})">GİR</button>
        `;
        roomsList.appendChild(div);
    });
});

let tempRoomId = null;
window.preJoin = (id, name, hasPass) => {
    const user = document.getElementById('username').value;
    if(!user) return alert("Ad yazın!");
    tempRoomId = id;
    if(hasPass) {
        passwordModal.classList.remove('hidden');
    } else {
        checkAndJoin(id, null, name);
    }
};

document.getElementById('confirm-join-btn').onclick = () => {
    const pwd = document.getElementById('join-password-input').value;
    checkAndJoin(tempRoomId, pwd, "Room");
    passwordModal.classList.add('hidden');
};
document.getElementById('cancel-join-btn').onclick = () => passwordModal.classList.add('hidden');

function checkAndJoin(id, pwd, name) {
    socket.emit('check-room', id, pwd, (res) => {
        if(res.success) enterRoom(id, name);
        else alert(res.msg);
    });
}

function enterRoom(id, name) {
    currentRoomId = id;
    const user = document.getElementById('username').value;
    lobby.classList.add('hidden');
    roomDiv.classList.remove('hidden');
    document.getElementById('active-room-name').innerText = name;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micSelect.value ? { exact: micSelect.value } : undefined },
        video: false
    }).then(stream => {
        myStream = stream;
        addParticipant(myPeer.id, user, true, stream);

        myPeer.on('call', call => {
            call.answer(stream);
            const vid = document.createElement('video');
            call.on('stream', userStream => {
                // Video stream gələndə avtomatik göstər
                addVideoStream(vid, userStream, call.peer);
            });
            peers[call.peer] = call;
        });

        socket.on('user-connected', (uid, uname) => {
            const call = myPeer.call(uid, stream);
            const vid = document.createElement('video');
            call.on('stream', userStream => {
                addVideoStream(vid, userStream, uid);
            });
            peers[uid] = call;
            addParticipant(uid, uname, false);
        });

        socket.emit('join-room', id, myPeer.id, user);
    });
}

socket.on('current-participants', (users) => {
    users.forEach(u => {
        if(u.id !== myPeer.id) addParticipant(u.id, u.name, false);
    });
});

socket.on('user-disconnected', id => {
    if(peers[id]) peers[id].close();
    const el = document.getElementById(`card-${id}`);
    if(el) el.remove();
});

socket.on('admin-status', s => iamAdmin = s);
socket.on('kicked-notification', () => location.reload());

// --- UI FUNKSİYALARI ---

function addParticipant(id, name, isMe, stream=null) {
    if(document.getElementById(`card-${id}`)) return;

    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `card-${id}`;
    
    let menuHtml = '';
    if(!isMe) {
        menuHtml = `
            <div class="menu-dots" onclick="toggleMenu('${id}')">⋮</div>
            <div id="menu-${id}" class="dropdown-menu">
                <div class="dropdown-item" onclick="kickUser('${id}')">Qov (Kick)</div>
            </div>
        `;
    }

    div.innerHTML = `
        <video id="video-${id}" autoplay playsinline muted></video>
        <div id="avatar-${id}" class="avatar"><i class="fa-solid fa-microphone"></i></div>
        <div class="user-name">${name}</div>
        ${menuHtml}
        <canvas class="visualizer-canvas"></canvas>
    `;
    videoGrid.appendChild(div);

    if(stream) {
        setupVisualizer(stream, div.querySelector('canvas'));
        const vid = div.querySelector('video');
        vid.srcObject = stream;
        vid.style.display = 'none'; // Başlanğıcda video yoxdur
    }
}

// 3 Nöqtə Menyu Funksiyaları
window.toggleMenu = (id) => {
    if(!iamAdmin) return;
    const menu = document.getElementById(`menu-${id}`);
    // Digər bütün menyuları bağla
    document.querySelectorAll('.dropdown-menu').forEach(m => {
        if(m !== menu) m.classList.remove('show');
    });
    menu.classList.toggle('show');
};
window.kickUser = (id) => {
    socket.emit('kick-user', id);
};
// Boş yerə basanda menyunu bağla
document.addEventListener('click', (e) => {
    if(!e.target.closest('.user-card')) {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    }
});


function addVideoStream(video, stream, id) {
    const card = document.getElementById(`card-${id}`);
    if(!card) return; // Kart hələ yaranmayıb (gecikmə)

    // Əgər videonun içində köhnə video varsa silmə, source dəyiş
    const existingVideo = document.getElementById(`video-${id}`);
    existingVideo.srcObject = stream;
    
    // Vizualizatoru yenilə
    setupVisualizer(stream, card.querySelector('canvas'));

    // Video trackın aktiv olub olmadığını yoxla
    checkVideoStatus(stream, id);
    
    // Track dəyişəndə (ekranı aç/bağla) statusu yoxla
    stream.getVideoTracks()[0].onmute = () => checkVideoStatus(stream, id);
    stream.getVideoTracks()[0].onunmute = () => checkVideoStatus(stream, id);
    stream.getVideoTracks()[0].onended = () => checkVideoStatus(stream, id);
}

function checkVideoStatus(stream, id) {
    const videoTrack = stream.getVideoTracks()[0];
    const vidEl = document.getElementById(`video-${id}`);
    const avEl = document.getElementById(`avatar-${id}`);
    
    if (videoTrack && videoTrack.enabled && videoTrack.readyState === 'live') {
        vidEl.style.display = 'block';
        avEl.style.display = 'none';
    } else {
        vidEl.style.display = 'none';
        avEl.style.display = 'flex';
    }
}

// Visualizer (Bottom Bar)
function setupVisualizer(stream, canvas) {
    if(!audioContext) return;
    const src = audioContext.createMediaStreamSource(stream);
    const anl = audioContext.createAnalyser();
    src.connect(anl);
    anl.fftSize = 64;
    const len = anl.frequencyBinCount;
    const data = new Uint8Array(len);
    const ctx = canvas.getContext('2d');

    function draw() {
        requestAnimationFrame(draw);
        anl.getByteFrequencyData(data);
        ctx.clearRect(0,0,canvas.width,canvas.height);
        
        const barW = canvas.width / len;
        let x = 0;
        for(let i=0; i<len; i++) {
            const h = (data[i] / 255) * canvas.height; // Düzgün hündürlük
            ctx.fillStyle = '#5865F2';
            ctx.fillRect(x, canvas.height - h, barW, h);
            x += barW;
        }
    }
    draw();
}

// CHAT UI
document.getElementById('chat-toggle-btn').onclick = () => {
    document.getElementById('chat-sidebar').classList.toggle('collapsed');
    document.getElementById('chat-badge').classList.add('hidden');
};
document.getElementById('close-chat').onclick = () => {
    document.getElementById('chat-sidebar').classList.add('collapsed');
};
document.getElementById('send-msg-btn').onclick = () => {
    const inp = document.getElementById('chat-input');
    const txt = inp.value;
    const usr = document.getElementById('username').value;
    if(txt) {
        socket.emit('send-message', txt, currentRoomId, usr);
        addMsg(usr, txt, true);
        inp.value = '';
    }
};
socket.on('receive-message', d => {
    addMsg(d.username, d.message, false);
    if(document.getElementById('chat-sidebar').classList.contains('collapsed'))
        document.getElementById('chat-badge').classList.remove('hidden');
});
function addMsg(u, m, me) {
    const box = document.getElementById('chat-messages');
    const d = document.createElement('div');
    d.className = `message ${me?'my-msg':''}`;
    d.innerHTML = `<b>${me?'':u+':'}</b> ${m}`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
}

// MUTE/DEAF
const mBtn = document.getElementById('mic-btn');
const dBtn = document.getElementById('headphone-btn');
mBtn.onclick = () => {
    if(isDeafened) return;
    isMicMuted = !isMicMuted;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    mBtn.classList.toggle('muted-btn');
};
dBtn.onclick = () => {
    isDeafened = !isDeafened;
    isMicMuted = isDeafened;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    dBtn.classList.toggle('muted-btn');
    mBtn.classList.toggle('muted-btn', isMicMuted);
    document.querySelectorAll('video').forEach(v => v.muted = isDeafened);
};
