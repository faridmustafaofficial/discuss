const socket = io('/');

const myPeer = new Peer(undefined, {
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
});

// Elementlər
const lobbyContainer = document.getElementById('lobby-container');
const roomContainer = document.getElementById('room-container');
const roomsListEl = document.getElementById('rooms-list');
const videoGrid = document.getElementById('video-grid');
const chatSidebar = document.getElementById('chat-sidebar');
const messagesBox = document.getElementById('chat-messages');
const micSelect = document.getElementById('mic-select');
const contextMenu = document.getElementById('context-menu');
const chatBadge = document.getElementById('chat-badge');

// Dəyişənlər
const peers = {}; 
let myStream;
let currentRoomId = null;
let isMicMuted = false;
let isDeafened = false;
let iamAdmin = false;
let targetKickId = null;

// --- CİHAZ SEÇİMİ ---
async function getCameras() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); // İcazə istə
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        micSelect.innerHTML = '';
        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Mikrofon ${micSelect.length + 1}`;
            micSelect.appendChild(option);
        });
    } catch (e) {
        console.log("Cihaz icazəsi yoxdur");
    }
}
getCameras();

// --- UI DÜYMƏLƏRİ ---
document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-val').innerText = this.value;
}

document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('room-name').value;
    const username = document.getElementById('username').value;
    const limit = document.getElementById('limit-slider').value;
    if(name && username) socket.emit('create-room', { roomName: name, limit, username });
    else alert("Zəhmət olmasa Ad və Otaq adını yazın!");
};

document.getElementById('leave-btn').onclick = () => window.location.reload();

// Chat
document.getElementById('chat-toggle-btn').onclick = () => {
    chatSidebar.classList.toggle('collapsed');
    chatBadge.classList.add('hidden'); // Oxuyanda badge-i sil
};
document.getElementById('close-chat').onclick = () => chatSidebar.classList.add('collapsed');

document.getElementById('send-msg-btn').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value;
    const username = document.getElementById('username').value;
    if(msg.trim()) {
        appendMessage(username, msg, true);
        socket.emit('send-message', msg, currentRoomId, username);
        input.value = '';
    }
}

function appendMessage(user, text, isMe) {
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'my-msg' : ''}`;
    div.innerHTML = `<strong>${isMe ? '' : user + ':'}</strong> ${text}`;
    messagesBox.appendChild(div);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

// --- SOCKET LOGIC ---

socket.on('room-list', (rooms) => {
    roomsListEl.innerHTML = '';
    const roomKeys = Object.keys(rooms);
    
    if(roomKeys.length === 0) {
        roomsListEl.innerHTML = '<div style="text-align:center; color:#555; padding:20px;">Aktiv otaq yoxdur</div>';
        return;
    }

    Object.values(rooms).forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        
        const isFull = room.users.length >= room.limit;
        const btnAttr = isFull ? 'disabled' : '';
        const countColor = isFull ? 'color:#da373c' : 'color:#949ba4';

        div.innerHTML = `
            <div>
                <span style="font-weight:bold; display:block;">${room.name}</span>
                <span style="font-size:12px; ${countColor}"><i class="fa-solid fa-user-group"></i> ${room.users.length}/${room.limit}</span>
            </div>
            <button class="join-btn" ${btnAttr} onclick="joinRoom('${room.id}', '${room.name}')">QOŞUL</button>
        `;
        roomsListEl.appendChild(div);
    });
});

socket.on('room-created', (id) => {
    const name = document.getElementById('room-name').value;
    joinRoom(id, name);
});

socket.on('receive-message', ({ message, username }) => {
    appendMessage(username, message, false);
    if(chatSidebar.classList.contains('collapsed')) {
        chatBadge.classList.remove('hidden');
        chatBadge.innerText = "!";
    }
});

socket.on('admin-status', (status) => iamAdmin = status);
socket.on('kicked-notification', () => {
    alert("Qovuldunuz!");
    location.reload();
});

// --- ROOM JOIN ---

window.joinRoom = (roomId, roomName) => {
    const username = document.getElementById('username').value;
    if(!username) { alert("Ad daxil edin!"); return; }
    
    currentRoomId = roomId;
    lobbyContainer.classList.add('hidden');
    roomContainer.classList.remove('hidden'); // Ekrani dəyiş
    document.getElementById('active-room-name').innerText = roomName;

    // Stream
    const selectedMic = micSelect.value;
    navigator.mediaDevices.getUserMedia({
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
        video: false
    }).then(stream => {
        myStream = stream;
        addParticipantUi(myPeer.id, username, true);

        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            call.on('stream', st => addVideoStream(video, st));
            peers[call.peer] = call;
        });

        socket.on('user-connected', (userId, userName) => {
            connectToNewUser(userId, stream, userName);
            addParticipantUi(userId, userName, false);
        });

        socket.emit('join-room', roomId, myPeer.id, username);
    }).catch(err => {
        console.error(err);
        alert("Mikrofona icazə verilmədi!");
    });
};

socket.on('current-participants', (users) => {
    users.forEach(u => {
        if(u.id !== myPeer.id) addParticipantUi(u.id, u.name, false);
    });
});

socket.on('user-disconnected', userId => {
    if (peers[userId]) peers[userId].close();
    const el = document.getElementById(`user-${userId}`);
    if(el) el.remove();
});

// --- HELPER FUNCS ---

function connectToNewUser(userId, stream, userName) {
    const call = myPeer.call(userId, stream);
    const video = document.createElement('video');
    call.on('stream', st => addVideoStream(video, st));
    peers[userId] = call;
}

function addParticipantUi(userId, userName, isMe) {
    if(document.getElementById(`user-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `user-${userId}`;
    div.innerHTML = `
        <div class="avatar" style="${isMe ? 'border-color: #5865F2' : ''}">
            <i class="fa-solid fa-microphone"></i>
        </div>
        <div class="user-name">${userName}</div>
    `;

    // Context Menu Logic
    if(!isMe) {
        div.addEventListener('contextmenu', (e) => {
            if(iamAdmin) {
                e.preventDefault();
                targetKickId = userId;
                contextMenu.style.top = `${e.pageY}px`;
                contextMenu.style.left = `${e.pageX}px`;
                contextMenu.classList.remove('hidden');
            }
        });
    }
    videoGrid.appendChild(div);
}

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
});
document.getElementById('close-context').onclick = () => contextMenu.classList.add('hidden');
document.getElementById('kick-option').onclick = () => {
    if(targetKickId) socket.emit('kick-user', targetKickId);
    contextMenu.classList.add('hidden');
};

function addVideoStream(video, stream) {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => video.play());
    video.style.display = 'none'; 
    videoGrid.append(video);
}

// Mute/Deafen
const micBtn = document.getElementById('mic-btn');
const deafBtn = document.getElementById('headphone-btn');

micBtn.onclick = () => {
    if(isDeafened) return;
    isMicMuted = !isMicMuted;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    updateBtnStyle(micBtn, isMicMuted, '<i class="fa-solid fa-microphone"></i>', '<i class="fa-solid fa-microphone-slash"></i>');
    
    // UI-da öz avatarımda danışmadığımı göstər (Vizual effekt üçün gələcəkdə istifadə oluna bilər)
};

deafBtn.onclick = () => {
    isDeafened = !isDeafened;
    isMicMuted = isDeafened; // Qulaqlıq bağlananda mik də bağlanır
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    
    updateBtnStyle(deafBtn, isDeafened, '<i class="fa-solid fa-headphones"></i>', '<i class="fa-solid fa-ear-deaf"></i>');
    updateBtnStyle(micBtn, isMicMuted, '<i class="fa-solid fa-microphone"></i>', '<i class="fa-solid fa-microphone-slash"></i>');

    videoGrid.querySelectorAll('video').forEach(v => v.muted = isDeafened);
};

function updateBtnStyle(btn, isActive, iconOn, iconOff) {
    if(isActive) {
        btn.classList.add('muted-btn');
        btn.innerHTML = iconOff;
    } else {
        btn.classList.remove('muted-btn');
        btn.innerHTML = iconOn;
    }
}
