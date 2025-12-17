const socket = io('/');

// HƏLL: Səs problemi üçün Google STUN serverləri
const myPeer = new Peer(undefined, {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
});

const lobbyContainer = document.getElementById('lobby-container');
const roomContainer = document.getElementById('room-container');
const roomsListEl = document.getElementById('rooms-list');
const videoGrid = document.getElementById('video-grid');
const chatSidebar = document.getElementById('chat-sidebar');
const messagesBox = document.getElementById('chat-messages');
const micSelect = document.getElementById('mic-select');
const contextMenu = document.getElementById('context-menu');

const peers = {}; 
let myStream;
let currentRoomId = null;
let isMicMuted = false;
let isDeafened = false;
let iamAdmin = false;
let targetKickId = null; // Kimi qovuruq?

// --- 1. MİKROFON SEÇİMİ VƏ CİHAZLAR ---
async function getCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    
    micSelect.innerHTML = '';
    audioInputs.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Mikrofon ${micSelect.length + 1}`;
        micSelect.appendChild(option);
    });
}
getCameras();

micSelect.onchange = async () => {
    if(myStream) {
        // Yeni cihazdan stream al
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micSelect.value } },
            video: false
        });
        
        // Audio Track-i dəyiş
        const audioTrack = newStream.getAudioTracks()[0];
        const oldTrack = myStream.getAudioTracks()[0];
        
        myStream.removeTrack(oldTrack);
        myStream.addTrack(audioTrack);

        // Aktiv zənglərdə track-i yenilə (PeerJS üçün bu biraz mürəkkəbdir,
        // sadə variant: Stream dəyişəndə səsi qarşı tərəfə yenidən göndəririk)
        // MVP üçün: İstifadəçiyə "Dəyişiklik üçün yenidən girin" demək olar,
        // amma müasir brauzerlərdə track avtomatik ötürülə bilər.
        
        // Səs bağlıdırsa yeni mikrofonu da bağla
        audioTrack.enabled = !isMicMuted;
    }
};

// --- UI EVENTLƏRİ ---
document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-val').innerText = this.value;
}

document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('room-name').value;
    const username = document.getElementById('username').value;
    const limit = document.getElementById('limit-slider').value;
    if(name && username) socket.emit('create-room', { roomName: name, limit, username });
};

document.getElementById('leave-btn').onclick = () => location.reload();

// Chat Aç/Bağla
document.getElementById('chat-toggle-btn').onclick = () => {
    chatSidebar.classList.toggle('collapsed');
};
document.getElementById('close-chat').onclick = () => {
    chatSidebar.classList.add('collapsed');
};

// Chat Mesaj Göndər
document.getElementById('send-msg-btn').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value;
    const username = document.getElementById('username').value;
    if(msg.trim()) {
        appendMessage(username, msg, true); // Öz mesajım
        socket.emit('send-message', msg, currentRoomId, username);
        input.value = '';
    }
}

function appendMessage(user, text, isMe) {
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'my-msg' : ''}`;
    div.innerHTML = `<strong>${isMe ? 'Sən' : user}:</strong> ${text}`;
    messagesBox.appendChild(div);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

// --- SOCKET MƏNTİQİ ---

socket.on('room-list', (rooms) => {
    roomsListEl.innerHTML = '';
    Object.values(rooms).forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <span>${room.name}</span>
            <div>
                <span>${room.users.length}/${room.limit}</span>
                <button class="join-btn" onclick="joinRoom('${room.id}', '${room.name}')">QOŞUL</button>
            </div>
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
        // Chat bağlıdırsa ikon qızarsın (notification effekti)
        document.getElementById('chat-toggle-btn').style.color = '#3498db';
    }
});

// Admin statusunu yoxla
socket.on('admin-status', (status) => {
    iamAdmin = status;
    if(iamAdmin) console.log("Siz bu otağın adminisiniz!");
});

socket.on('kicked-notification', () => {
    alert("Siz otaqdan qovuldunuz!");
    location.reload();
});


// --- QOŞULMA ---

window.joinRoom = (roomId, roomName) => {
    const username = document.getElementById('username').value;
    if(!username) { alert("Ad daxil edin!"); return; }
    
    currentRoomId = roomId;
    lobbyContainer.classList.add('hidden');
    roomContainer.classList.remove('hidden');
    document.getElementById('active-room-name').innerText = roomName;

    // Seçilmiş mikrofonu istifadə et
    const selectedMic = micSelect.value;
    const constraints = {
        video: false,
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true
    };

    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        myStream = stream;
        addParticipantUi(myPeer.id, username, true);

        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            call.on('stream', userVideoStream => {
                addVideoStream(video, userVideoStream);
            });
            peers[call.peer] = call;
        });

        socket.on('user-connected', (userId, userName) => {
            connectToNewUser(userId, stream, userName);
            addParticipantUi(userId, userName, false);
        });

        socket.emit('join-room', roomId, myPeer.id, username);
    });
};

socket.on('current-participants', (users, creatorId) => {
    users.forEach(user => {
        if(user.id !== myPeer.id) addParticipantUi(user.id, user.name, false);
    });
});

socket.on('user-disconnected', userId => {
    if (peers[userId]) peers[userId].close();
    const el = document.getElementById(`user-${userId}`);
    if(el) el.remove();
});

// --- KÖMƏKÇİ FUNKSİYALAR ---

function connectToNewUser(userId, stream, userName) {
    const call = myPeer.call(userId, stream);
    const video = document.createElement('video');
    call.on('stream', userVideoStream => {
        addVideoStream(video, userVideoStream);
    });
    peers[userId] = call;
}

function addParticipantUi(userId, userName, isMe) {
    if(document.getElementById(`user-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `user-${userId}`;
    div.innerHTML = `
        <div class="avatar"><i class="fa-solid fa-microphone"></i></div>
        <div class="user-name">${userName}</div>
    `;
    
    // Sağ Tık (Context Menu) - Yalnız Admin və başqasına tıklayanda
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

// Context Menu Gizlət
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
});

// Qovmaq düyməsi basılanda
document.getElementById('kick-option').onclick = () => {
    if(targetKickId) {
        socket.emit('kick-user', targetKickId);
        contextMenu.classList.add('hidden');
    }
};

function addVideoStream(video, stream) {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => video.play());
    video.style.display = 'none'; 
    videoGrid.append(video);
}

// Səs İdarəetmə (Eyni qaldı)
const micBtn = document.getElementById('mic-btn');
micBtn.onclick = () => {
    isMicMuted = !isMicMuted;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    micBtn.innerHTML = isMicMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
    micBtn.classList.toggle('muted-btn');
};
