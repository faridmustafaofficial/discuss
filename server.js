const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'rooms.json');
let rooms = {};

if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE);
        rooms = JSON.parse(data);
    } catch (err) {
        console.log("Database oxuma xətası, yenisi yaradılır.");
        rooms = {};
    }
}

function saveRooms() {
    fs.writeFileSync(DB_FILE, JSON.stringify(rooms, null, 2));
}

const socketToRoom = {};
const socketToUser = {};

io.on('connection', socket => {
  
  socket.emit('room-list', filterRoomsForPublic(rooms));

  socket.on('check-room', (roomId, passwordInput, callback) => {
      const room = rooms[roomId];
      if (!room) return callback({ success: false, msg: "Otaq tapılmadı" });
      if (room.users.length >= room.limit) return callback({ success: false, msg: "Otaq doludur" });
      
      if (room.password) {
          if (room.password === passwordInput) callback({ success: true });
          else callback({ success: false, msg: "Şifrə yanlışdır" });
      } else {
          callback({ success: true });
      }
  });

  socket.on('create-room', ({ roomName, limit, username, password }) => {
    const roomId = uuidv4();
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      limit: parseInt(limit),
      password: password || null, 
      users: [],
      creatorId: socket.id
    };
    saveRooms();
    
    io.emit('room-list', filterRoomsForPublic(rooms));
    socket.emit('room-created', roomId);
  });

  socket.on('join-room', (roomId, peerId, username) => {
    const room = rooms[roomId];
    if (room && room.users.length < room.limit) {
      socket.join(roomId);
      const newUser = { id: peerId, name: username, socketId: socket.id };
      room.users.push(newUser);
      saveRooms();

      socketToRoom[socket.id] = roomId;
      socketToUser[socket.id] = newUser;

      const isAdmin = (room.creatorId === socket.id);

      socket.to(roomId).emit('user-connected', peerId, username);
      socket.emit('current-participants', room.users, room.creatorId);
      socket.emit('admin-status', isAdmin);

      io.emit('room-list', filterRoomsForPublic(rooms));
    } else {
      socket.emit('full-or-error', 'Xəta baş verdi!');
    }
  });

  socket.on('send-message', (message, roomId, username) => {
      socket.to(roomId).emit('receive-message', { message, username });
  });

  socket.on('kick-user', (targetPeerId) => {
      const roomId = socketToRoom[socket.id];
      const room = rooms[roomId];
      if (room && room.creatorId === socket.id) {
          const targetUser = room.users.find(u => u.id === targetPeerId);
          if (targetUser) {
              io.to(targetUser.socketId).emit('kicked-notification');
              io.to(roomId).emit('user-disconnected', targetPeerId);
          }
      }
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    const user = socketToUser[socket.id];

    if (roomId && user && rooms[roomId]) {
      socket.to(roomId).emit('user-disconnected', user.id);
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== user.id);

      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId]; 
      }
      saveRooms();
      io.emit('room-list', filterRoomsForPublic(rooms));
    }
    delete socketToRoom[socket.id];
    delete socketToUser[socket.id];
  });
});

function filterRoomsForPublic(allRooms) {
    const publicData = {};
    for (const [id, room] of Object.entries(allRooms)) {
        publicData[id] = {
            id: room.id,
            name: room.name,
            limit: room.limit,
            users: room.users,
            hasPassword: !!room.password 
        };
    }
    return publicData;
}

server.listen(process.env.PORT || 3000);
