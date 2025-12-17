const socket = io('/');
const peer = new Peer(undefined, {
    host: '/', 
    port: 443, // Render üçün 443, local üçün 3000 ola bilər (Cloud PeerJS istifadə etsək daha rahatdır)
    // Sadəlik üçün default PeerJS serverini istifadə edirik:
    path: '/peerjs' // Bunu server.js-də qurmaq lazımdır, amma ən asanı cloud peerjs serveridir.
}); 
// QEYD: Əgər aşağıdakı 'new Peer()' işləməsə, 'host' parametrini silib sadəcə new Peer() saxlayın.
// MVP üçün sadə versiya:
const myPeer = new Peer(); 

const lobbyContainer = document.getElementById('lobby-container');
const roomContainer = document.getElementById('room-container');
const roomsListEl = document.getElementById('rooms-list');
const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true; // Öz səsimizi eşitməyək

const peers = {}; // Digər istifadəçilərin zəngləri
let myStream;
let currentRoomId;
let isMicMuted = false;
let isDeafened = false;

// UI Eventləri
document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-val').innerText = this.value;
}

document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('room-name').value;
    const username = document.getElementById('username').value || 'Anonim';
    const limit = document.getElementById('limit-slider').value;
    
    if(name) socket.emit('create-room', { roomName: name, limit, username });
};

document.getElementById('leave-btn').onclick = () => {
    location.reload(); // Ən sadə çıxış yolu səhifəni yeniləməkdir
};

// Səs İdarəetməsi
const micBtn = document.getElementById('mic-btn');
const deafBtn = document.getElementById('headphone-btn');

micBtn.onclick = () => {
    if(isDeafened) return; // Əgər karıqsa, mikrofon açıla bilməz
    isMicMuted = !isMicMuted;
    setMicState(isMicMuted);
};

deafBtn.onclick = () => {
    isDeafened = !isDeafened;
    // Eşitmə bağlananda mikrofon da avtomatik bağlanır
    if (isDeafened) {
        setMicState(true);
        deafBtn.classList.add('muted-btn');
        // Gələn bütün səsləri bağla
        videoGrid.querySelectorAll('video').forEach(v => v.muted = true);
    } else {
        // Eşitməni açanda mikrofonu əvvəlki halına qaytar (və ya bağlı saxla, seçim)
        deafBtn.classList.remove('muted-btn');
        // Mikrofonu əl ilə açmaq lazımdır, avtomatik açılmasın (təhlükəsizlik)
        videoGrid.querySelectorAll('video').forEach(v => {
            if(v !== myVideo) v.muted = false;
        });
    }
};

function setMicState(mute) {
    isMicMuted = mute;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    if(isMicMuted) micBtn.classList.add('muted-btn');
    else micBtn.classList.remove('muted-btn');
}


// Socket Eventləri
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
    // Yaradan avtomatik qoşulur
    const username = document.getElementById('username').value || 'Admin';
    joinRoom(id, document.getElementById('room-name').value);
});

// Otağa qoşulmaq funksiyası
window.joinRoom = (roomId, roomName) => {
    const username = document.getElementById('username').value || 'Qonaq';
    currentRoomId = roomId;
    
    // UI Dəyişimi
    lobbyContainer.classList.add('hidden');
    roomContainer.classList.remove('hidden');
    document.getElementById('active-room-name').innerText = roomName;

    // Mikrofonu əldə et
    navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
    }).then(stream => {
        myStream = stream;
        addParticipant(myPeer.id, username, stream, true); // Özümüzü əlavə edirik

        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            call.on('stream', userVideoStream => {
                addVideoStream(video, userVideoStream);
            });
        });

        socket.on('user-connected', (userId, userName) => {
            connectToNewUser(userId, stream, userName);
            // Vizual olaraq istifadəçini əlavə et
            addParticipantUi(userId, userName); 
        });
        
        // Serverə qoşulduğumuzu de
        socket.emit('join-room', roomId, myPeer.id, username);
    });
};

socket.on('current-participants', (users) => {
    users.forEach(user => {
        if(user.id !== myPeer.id) addParticipantUi(user.id, user.name);
    });
});

socket.on('user-disconnected', userId => {
    if (peers[userId]) peers[userId].close();
    const el = document.getElementById(`user-${userId}`);
    if(el) el.remove();
});


// Köməkçi Funksiyalar

function connectToNewUser(userId, stream, userName) {
    const call = myPeer.call(userId, stream);
    const video = document.createElement('video');
    call.on('stream', userVideoStream => {
        addVideoStream(video, userVideoStream);
    });
    call.on('close', () => {
        video.remove();
    });
    peers[userId] = call;
}

function addParticipantUi(userId, userName) {
    if(document.getElementById(`user-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `user-${userId}`;
    div.innerHTML = `
        <div class="avatar"><i class="fa-solid fa-microphone"></i></div>
        <div class="user-name">${userName}</div>
    `;
    videoGrid.appendChild(div);
}

// Özümüz üçün UI funksiyası
function addParticipant(userId, userName, stream, isMe) {
    addParticipantUi(userId, userName);
    // Səs dalğası effekti (sadə)
    // Burada AudioContext ilə səs analizi qurmaq olar, amma
    // sadəlik üçün CSS ilə idarə edəcəyik
}

function addVideoStream(video, stream) {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });
    // Video elementi görünməz olmalıdır, sadəcə səs gəlsin
    video.style.display = 'none'; 
    videoGrid.append(video);
}