const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));

// Otaqları yaddaşda saxlayırıq (Database yoxdur, RAM-da qalır)
let rooms = {}; 

io.on('connection', socket => {
  // 1. Otaqları yeni gələnə göndər
  socket.emit('room-list', rooms);

  // 2. Otaq Yaratmaq
  socket.on('create-room', ({ roomName, limit, username }) => {
    const roomId = uuidv4();
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      limit: parseInt(limit),
      users: []
    };
    
    // Yaradılan otağa avtomatik qoşul
    socket.emit('room-created', roomId);
    io.emit('room-list', rooms); // Hamıya yenilənmiş siyahını göndər
  });

  // 3. Otağa Qoşulmaq
  socket.on('join-room', (roomId, userId, username) => {
    const room = rooms[roomId];
    
    if (room && room.users.length < room.limit) {
      socket.join(roomId);
      room.users.push({ id: userId, name: username }); // İstifadəçini siyahıya at

      // Otaqdakılara xəbər ver: Yeni adam gəldi
      socket.to(roomId).emit('user-connected', userId, username);
      
      // Otaqdakıların siyahısını mənə göndər (Front-enddə göstərmək üçün)
      socket.emit('current-participants', room.users);

      // Hamıya otaq sayını yenilə
      io.emit('room-list', rooms);

      socket.on('disconnect', () => {
        socket.to(roomId).emit('user-disconnected', userId);
        
        // İstifadəçini otaqdan sil
        room.users = room.users.filter(user => user.id !== userId);
        
        // Əgər otaq boşdursa, otağı sil (Opsional)
        if (room.users.length === 0) {
          delete rooms[roomId];
        }
        
        io.emit('room-list', rooms);
      });
    } else {
      socket.emit('error', 'Otaq doludur və ya mövcud deyil!');
    }
  });
  
  // Səs vəziyyəti dəyişəndə (Mute/Unmute)
  socket.on('toggle-audio', (roomId, userId, isMuted) => {
      socket.to(roomId).emit('user-toggled-audio', userId, isMuted);
  });
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Server işləyir...');
});