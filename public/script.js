const socket = io('/');

const myPeer = new Peer(undefined, {
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
});

const lobbyContainer = document.getElementById('lobby-container');
const roomContainer = document.getElementById('room-container');
const roomsListEl = document.getElementById('rooms-list');
const videoGrid = document.getElementById('video-grid');
const chatSidebar = document.getElementById('chat-sidebar');
const messagesBox = document.getElementById('chat-messages');
const micSelect = document.getElementById('mic-select');
const contextMenu = document.getElementById('context-menu');
const chatBadge = document.getElementById('chat-badge');
const passwordModal = document.getElementById('password-modal');

const peers = {}; 
let myStream;
let myScreenStream;
let currentRoomId = null;
let isMicMuted = false;
let isDeafened = false;
let isScreenSharing = false;
let iamAdmin = false;
let targetKickId = null;
let pendingRoomId = null; 

let audioContext; 

async function getCameras() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
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

document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-val').innerText = this.value;
}

document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('room-name').value;
    const username = document.getElementById('username').value;
    const limit = document.getElementById('limit-slider').value;
    const password = document.getElementById('room-password').value;

    if(name && username) socket.emit('create-room', { roomName: name, limit, username, password });
    else alert("Zəhmət olmasa Ad və Otaq adını yazın!");
};

document.getElementById('leave-btn').onclick = () => window.location.reload();

document.getElementById('chat-toggle-btn').onclick = () => {
    chatSidebar.classList.toggle('collapsed');
    chatBadge.classList.add('hidden');
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

// Ekran Paylaşımı
document.getElementById('screen-share-btn').onclick = async () => {
    if (isScreenSharing) {
        // Ekranı bağla, kameraya/mikrofona qayıt
        const selectedMic = micSelect.value;
        const stream = await navigator.mediaDevices.getUserMedia({
             audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
             video: false 
        });
        replaceStream(stream);
        isScreenSharing = false;
        document.getElementById('screen-share-btn').classList.remove('active-btn');
    } else {
        // Ekranı aç
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            replaceStream(stream);
            isScreenSharing = true;
            document.getElementById('screen-share-btn').classList.add('active-btn');
            
            stream.getVideoTracks()[0].onended = () => {
                document.getElementById('screen-share-btn').click(); 
            };
        } catch(e) {
            console.log("Ekran paylaşımı ləğv edildi");
        }
    }
};

function replaceStream(newStream) {
    const videoTrack = newStream.getVideoTracks()[0];
    const audioTrack = newStream.getAudioTracks()[0];

    // Peer zənglərindəki trackları dəyiş
    for (let peerId in peers) {
        const sender = peers[peerId].peerConnection.getSenders().find(s => {
            return s.track.kind === (videoTrack ? 'video' : 'audio');
        });
        if(sender) {
            sender.replaceTrack(videoTrack || audioTrack);
        }
    }
    myStream = newStream;
}


// Socket Logic
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
        const lockIcon = room.hasPassword ? '<i class="fa-solid fa-lock" style="color:#faa61a; margin-left:5px;"></i>' : '';

        div.innerHTML = `
            <div>
                <span style="font-weight:bold; display:block;">${room.name} ${lockIcon}</span>
                <span style="font-size:12px; ${countColor}"><i class="fa-solid fa-user-group"></i> ${room.users.length}/${room.limit}</span>
            </div>
            <button class="join-btn" ${btnAttr} onclick="tryJoinRoom('${room.id}', '${room.name}', ${room.hasPassword})">QOŞUL</button>
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
    }
});

socket.on('admin-status', (status) => iamAdmin = status);
socket.on('kicked-notification', () => {
    alert("Qovuldunuz!");
    location.reload();
});


// JOIN LOGIC
window.tryJoinRoom = (roomId, roomName, hasPassword) => {
    const username = document.getElementById('username').value;
    if(!username) { alert("Ad daxil edin!"); return; }
    
    pendingRoomId = roomId;

    if (hasPassword) {
        passwordModal.classList.remove('hidden');
        document.getElementById('active-room-name').innerText = roomName; 
    } else {
        checkAndJoin(roomId, null, roomName);
    }
};

document.getElementById('confirm-join-btn').onclick = () => {
    const pwd = document.getElementById('join-password-input').value;
    const roomName = document.getElementById('active-room-name').innerText;
    checkAndJoin(pendingRoomId, pwd, roomName);
    passwordModal.classList.add('hidden');
};
document.getElementById('cancel-join-btn').onclick = () => passwordModal.classList.add('hidden');

function checkAndJoin(roomId, password, roomName) {
    socket.emit('check-room', roomId, password, (response) => {
        if (response.success) {
            joinRoom(roomId, roomName);
        } else {
            alert(response.msg || "Xəta!");
        }
    });
}

function joinRoom(roomId, roomName) {
    const username = document.getElementById('username').value;
    currentRoomId = roomId;
    lobbyContainer.classList.add('hidden');
    roomContainer.classList.remove('hidden');
    document.getElementById('active-room-name').innerText = roomName;

    // Audio Context Yarad (Visualizer üçün)
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const selectedMic = micSelect.value;
    navigator.mediaDevices.getUserMedia({
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
        video: false
    }).then(stream => {
        myStream = stream;
        addParticipantUi(myPeer.id, username, true, stream);

        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            call.on('stream', st => addVideoStream(video, st, call.peer));
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
}


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

function connectToNewUser(userId, stream, userName) {
    const call = myPeer.call(userId, stream);
    const video = document.createElement('video');
    call.on('stream', st => addVideoStream(video, st, userId));
    peers[userId] = call;
}

function addParticipantUi(userId, userName, isMe, localStream = null) {
    if(document.getElementById(`user-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `user-${userId}`;
    div.innerHTML = `
        <div class="avatar" style="${isMe ? 'border-color: #5865F2' : ''}">
            <i class="fa-solid fa-microphone"></i>
        </div>
        <div class="user-name">${userName}</div>
        <canvas class="visualizer-canvas"></canvas>
        <input type="range" class="volume-control" min="0" max="1" step="0.01" value="1" ${isMe ? 'disabled style="opacity:0"' : ''}>
    `;

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

        // Volume Control Logic
        const slider = div.querySelector('.volume-control');
        slider.oninput = (e) => {
            const vid = document.getElementById(`video-${userId}`);
            if(vid) vid.volume = e.target.value;
        };
    } else if (localStream) {
        setupVisualizer(localStream, div.querySelector('canvas'));
    }
    
    videoGrid.appendChild(div);
}

// Visualizer
function setupVisualizer(stream, canvas) {
    if (!audioContext) return;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 64;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const ctx = canvas.getContext('2d');

    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const width = canvas.width / bufferLength;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i] / 2; 
            ctx.fillStyle = `rgb(88, 101, 242)`;
            ctx.fillRect(x, canvas.height - barHeight, width - 2, barHeight);
            x += width;
        }
    }
    draw();
}


document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
});
document.getElementById('close-context').onclick = () => contextMenu.classList.add('hidden');
document.getElementById('kick-option').onclick = () => {
    if(targetKickId) socket.emit('kick-user', targetKickId);
    contextMenu.classList.add('hidden');
};

function addVideoStream(video, stream, userId) {
    video.srcObject = stream;
    video.id = `video-${userId}`;
    video.addEventListener('loadedmetadata', () => video.play());
    video.style.display = 'none'; 
    videoGrid.append(video);

    // Vizualizatoru remote stream üçün başlat
    const userCard = document.getElementById(`user-${userId}`);
    if(userCard) {
        setupVisualizer(stream, userCard.querySelector('canvas'));
    }
}

const micBtn = document.getElementById('mic-btn');
const deafBtn = document.getElementById('headphone-btn');

micBtn.onclick = () => {
    if(isDeafened) return;
    isMicMuted = !isMicMuted;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    updateBtnStyle(micBtn, isMicMuted, '<i class="fa-solid fa-microphone"></i>', '<i class="fa-solid fa-microphone-slash"></i>');
};

deafBtn.onclick = () => {
    isDeafened = !isDeafened;
    isMicMuted = isDeafened;
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
