const socket = io('/'); // Render-də avtomatik işləyəcək
// PeerJS serveri cloud-dan istifadə edirik (stabil olması üçün)
const myPeer = new Peer(undefined); 

const lobbyContainer = document.getElementById('lobby-container');
const roomContainer = document.getElementById('room-container');
const roomsListEl = document.getElementById('rooms-list');
const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true; 

const peers = {}; // Aktiv zənglər
let myStream;
let currentRoomId = null; // Hazırda olduğumuz otaq
let isMicMuted = false;
let isDeafened = false;

// ---- UI Hissəsi ----

document.getElementById('limit-slider').oninput = function() {
    document.getElementById('limit-val').innerText = this.value;
}

document.getElementById('create-btn').onclick = () => {
    const name = document.getElementById('room-name').value;
    const username = document.getElementById('username').value;
    const limit = document.getElementById('limit-slider').value;
    
    if(!username) { alert("Zəhmət olmasa ad daxil edin!"); return; }
    if(name) socket.emit('create-room', { roomName: name, limit, username });
};

document.getElementById('leave-btn').onclick = () => {
    // Səhifəni yeniləmək serverdə 'disconnect' eventini işə salır
    window.location.reload(); 
};

// ---- Socket Logic ----

socket.on('room-list', (rooms) => {
    roomsListEl.innerHTML = '';
    // Əgər otaqlar boşdursa
    if(Object.keys(rooms).length === 0) {
        roomsListEl.innerHTML = '<div style="text-align:center; color:#555;">Hələ heç bir otaq yoxdur...</div>';
        return;
    }

    Object.values(rooms).forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        
        // Dolu otağın düyməsini deaktiv et
        const isFull = room.users.length >= room.limit;
        const btnState = isFull ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : '';
        const btnText = isFull ? 'DOLU' : 'QOŞUL';

        div.innerHTML = `
            <span>${room.name}</span>
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:12px; color:#aaa;">${room.users.length}/${room.limit}</span>
                <button class="join-btn" ${btnState} onclick="joinRoom('${room.id}', '${room.name}')">${btnText}</button>
            </div>
        `;
        roomsListEl.appendChild(div);
    });
});

socket.on('room-created', (id) => {
    const name = document.getElementById('room-name').value;
    joinRoom(id, name);
});

socket.on('full-or-error', (msg) => {
    alert(msg);
    window.location.reload();
});

// ---- Otağa Qoşulma və WebRTC ----

window.joinRoom = (roomId, roomName) => {
    const username = document.getElementById('username').value;
    if(!username) { alert("Əvvəlcə adınızı daxil edin!"); return; }

    currentRoomId = roomId;
    
    // UI Keçidi
    lobbyContainer.classList.add('hidden');
    roomContainer.classList.remove('hidden');
    document.getElementById('active-room-name').innerText = roomName;

    navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
    }).then(stream => {
        myStream = stream;
        
        // Özümüzü əlavə edirik (səssiz)
        addParticipantUi(myPeer.id, username, true);

        // Kimsə mənə zəng edəndə (Mən otağa girəndə köhnələr zəng edir və ya tərsi)
        myPeer.on('call', call => {
            call.answer(stream); // Cavab ver və stream göndər
            
            const video = document.createElement('video');
            call.on('stream', userVideoStream => {
                addVideoStream(video, userVideoStream);
            });
            
            // Call ID-ni user ID kimi istifadə etmək üçün serverdən gələn datanı gözləmək lazımdır
            // Amma PeerJS-də call.peer qarşı tərəfin ID-sidir.
            peers[call.peer] = call;
        });

        socket.on('user-connected', (userId, userName) => {
            // Yeni gələnə zəng et
            connectToNewUser(userId, stream, userName);
            addParticipantUi(userId, userName, false); 
        });

        // Serverə qoşulduğumuzu bildiririk
        socket.emit('join-room', roomId, myPeer.id, username);
    }).catch(err => {
        console.error("Mikrofon xətası:", err);
        alert("Mikrofona icazə vermədiniz!");
        window.location.reload();
    });
};

socket.on('current-participants', (users) => {
    // Otaqda məndən əvvəl olanları çək
    users.forEach(user => {
        if(user.id !== myPeer.id) {
            addParticipantUi(user.id, user.name, false);
        }
    });
});

// Çıxış edən istifadəçini silmək
socket.on('user-disconnected', userId => {
    if (peers[userId]) peers[userId].close(); // WebRTC əlaqəsini kəs
    const el = document.getElementById(`user-${userId}`);
    if(el) el.remove(); // UI-dan sil
    delete peers[userId];
});

// ---- Köməkçi Funksiyalar ----

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

function addParticipantUi(userId, userName, isMe) {
    // Təkrarçılığın qarşısını al
    if(document.getElementById(`user-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'user-card';
    div.id = `user-${userId}`;
    
    // Özümüzüksə fərqli rəngdə və ya işarədə göstər
    const borderStyle = isMe ? 'border: 3px solid #3498db;' : 'border: 3px solid #333;';
    
    div.innerHTML = `
        <div class="avatar" style="${borderStyle}">
            <i class="fa-solid fa-microphone"></i>
        </div>
        <div class="user-name">${userName} ${isMe ? '(Sən)' : ''}</div>
    `;
    videoGrid.appendChild(div);
}

function addVideoStream(video, stream) {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });
    video.style.display = 'none'; // Videonu gizlət, səs gəlsin
    videoGrid.append(video);
}

// Mikrofon və Qulaqlıq Düymələri
const micBtn = document.getElementById('mic-btn');
const deafBtn = document.getElementById('headphone-btn');

micBtn.onclick = () => {
    if(isDeafened) return;
    isMicMuted = !isMicMuted;
    myStream.getAudioTracks()[0].enabled = !isMicMuted;
    micBtn.classList.toggle('muted-btn');
    micBtn.innerHTML = isMicMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
};

deafBtn.onclick = () => {
    isDeafened = !isDeafened;
    if (isDeafened) {
        // Eşitməni bağla (bütün videoları mute et)
        videoGrid.querySelectorAll('video').forEach(v => v.muted = true);
        
        // Mikrofonu da bağla (avtomatik)
        isMicMuted = true;
        myStream.getAudioTracks()[0].enabled = false;
        
        deafBtn.classList.add('muted-btn');
        micBtn.classList.add('muted-btn'); // Mic də qırmızı olsun
        micBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    } else {
        // Eşitməni aç
        videoGrid.querySelectorAll('video').forEach(v => {
            if(v !== myVideo) v.muted = false;
        });
        
        deafBtn.classList.remove('muted-btn');
        // Mikrofonu əl ilə açmaq lazımdır (istifadəçi istəsə)
    }
};
