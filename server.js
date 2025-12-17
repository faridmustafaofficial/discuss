const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));

const rooms = {};        
const socketToRoom = {}; 
const socketToUser = {}; 

io.on('connection', socket => {
  socket.emit('room-list', rooms);

  // Otaq Yaratmaq (Creator ID əlavə etdik)
  socket.on('create-room', ({ roomName, limit, username }) => {
    const roomId = uuidv4();
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      limit: parseInt(limit),
      users: [],
      creatorId: socket.id // Yaradanın Socket ID-si
    };
    io.emit('room-list', rooms);
    socket.emit('room-created', roomId);
  });

  socket.on('join-room', (roomId, peerId, username) => {
    const room = rooms[roomId];
    if (room && room.users.length < room.limit) {
      socket.join(roomId);
      const newUser = { id: peerId, name: username, socketId: socket.id };
      room.users.push(newUser);
      socketToRoom[socket.id] = roomId;
      socketToUser[socket.id] = newUser;

      // Admin olub olmadığını yoxla
      const isAdmin = (room.creatorId === socket.id);

      // Digərlərinə xəbər ver
      socket.to(roomId).emit('user-connected', peerId, username);
      
      // Qoşulana otaq məlumatını və adminin kim olduğunu göndər
      socket.emit('current-participants', room.users, room.creatorId);
      
      // Admin statusunu özünə bildir
      socket.emit('admin-status', isAdmin);

      io.emit('room-list', rooms);
    } else {
      socket.emit('full-or-error', 'Otaq doludur!');
    }
  });

  // Mesajlaşma
  socket.on('send-message', (message, roomId, username) => {
      socket.to(roomId).emit('receive-message', { message, username });
  });

  // Qovma (Kick) Sistemi
  socket.on('kick-user', (targetPeerId) => {
      const roomId = socketToRoom[socket.id];
      const room = rooms[roomId];

      // Yalnız admin qova bilər
      if (room && room.creatorId === socket.id) {
          // Qovulacaq istifadəçinin socket ID-sini tap
          const targetUser = room.users.find(u => u.id === targetPeerId);
          if (targetUser) {
              // Həmin istifadəçiyə "Qovuldun" siqnalı göndər
              io.to(targetUser.socketId).emit('kicked-notification');
              // Digərlərinə bildir ki, əlaqəni kəssinlər
              io.to(roomId).emit('user-disconnected', targetPeerId); // UI-dan silinmək üçün
          }
      }
  });

  // Çıxış (Disconnect)
  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    const user = socketToUser[socket.id];

    if (roomId && user && rooms[roomId]) {
      // Əgər admin çıxırsa, otaq dağıla bilər və ya adminlik başqasına keçə bilər
      // Sadəlik üçün admin çıxanda otağı silmirik, sadəcə çıxır.
      
      socket.to(roomId).emit('user-disconnected', user.id);
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== user.id);

      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId];
      }
      io.emit('room-list', rooms);
    }
    delete socketToRoom[socket.id];
    delete socketToUser[socket.id];
  });

  socket.on('toggle-audio', (roomId, userId, isMuted) => {
      socket.to(roomId).emit('user-toggled-audio', userId, isMuted);
  });
});

server.listen(process.env.PORT || 3000);
