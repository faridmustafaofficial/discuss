const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

app.use(express.static('public'));

// Verilənlər Bazası (JSON Faylı)
const DB_FILE = path.join(__dirname, 'rooms.json');
let rooms = {};

// Server açılanda bazanı oxu
if (fs.existsSync(DB_FILE)) {
    try {
        rooms = JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) { rooms = {}; }
}

function saveRooms() {
    fs.writeFileSync(DB_FILE, JSON.stringify(rooms, null, 2));
}

// Socket Xəritələri
const socketToRoom = {};
const socketToUser = {};

io.on('connection', socket => {

    // 1. Otaqları göndər
    socket.emit('room-list', filterPublicRooms(rooms));

    // 2. Otağı Yoxla (Şifrə üçün)
    socket.on('check-room', (roomId, password, cb) => {
        const room = rooms[roomId];
        if(!room) return cb({success: false, msg: "Otaq tapılmadı"});
        if(room.users.length >= room.limit) return cb({success: false, msg: "Otaq doludur"});
        if(room.password && room.password !== password) return cb({success: false, msg: "Yanlış şifrə"});
        cb({success: true});
    });

    // 3. Otaq Yarat
    socket.on('create-room', ({ name, limit, user, pass }) => {
        const id = uuidv4();
        rooms[id] = {
            id, name, limit: parseInt(limit), password: pass || null,
            users: [], creatorId: socket.id
        };
        saveRooms();
        io.emit('room-list', filterPublicRooms(rooms));
        socket.emit('room-created', id);
    });

    // 4. Otağa Qoşul
    socket.on('join-room', (roomId, peerId, username) => {
        const room = rooms[roomId];
        if(room && room.users.length < room.limit) {
            socket.join(roomId);
            const newUser = { id: peerId, name: username, socketId: socket.id };
            room.users.push(newUser);
            
            socketToRoom[socket.id] = roomId;
            socketToUser[socket.id] = newUser;
            saveRooms();

            const isAdmin = (room.creatorId === socket.id);

            socket.to(roomId).emit('user-connected', peerId, username);
            socket.emit('participants', room.users);
            socket.emit('admin-status', isAdmin);
            
            io.emit('room-list', filterPublicRooms(rooms));
        }
    });

    // 5. Mesaj
    socket.on('send-message', (msg, roomId, user) => {
        socket.to(roomId).emit('receive-message', { msg, user });
    });

    // 6. Kick (Qovmaq)
    socket.on('kick-user', (targetPeerId) => {
        const roomId = socketToRoom[socket.id];
        const room = rooms[roomId];
        if(room && room.creatorId === socket.id) {
            const target = room.users.find(u => u.id === targetPeerId);
            if(target) {
                io.to(target.socketId).emit('kicked');
                io.to(roomId).emit('user-disconnected', targetPeerId);
                
                // Bazadan sil
                room.users = room.users.filter(u => u.id !== targetPeerId);
                saveRooms();
            }
        }
    });

    // 7. Çıxış
    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        const user = socketToUser[socket.id];
        
        if(roomId && user && rooms[roomId]) {
            socket.to(roomId).emit('user-disconnected', user.id);
            rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== user.id);
            
            if(rooms[roomId].users.length === 0) delete rooms[roomId];
            
            saveRooms();
            io.emit('room-list', filterPublicRooms(rooms));
        }
        delete socketToRoom[socket.id];
        delete socketToUser[socket.id];
    });
});

function filterPublicRooms(all) {
    const pub = {};
    for(let id in all) {
        pub[id] = {
            id, name: all[id].name, limit: all[id].limit,
            count: all[id].users.length, hasPass: !!all[id].password
        };
    }
    return pub;
}

server.listen(process.env.PORT || 3000, () => console.log('Server işləyir...'));
