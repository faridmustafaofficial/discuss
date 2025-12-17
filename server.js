const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));

// DATA STRUKTURU
const rooms = {};        // Otaqların əsas siyahısı: { roomId: { name, limit, users: [] } }
const socketToRoom = {}; // Socket ID -> Room ID əlaqəsi (Sürətli tapmaq üçün)
const socketToUser = {}; // Socket ID -> User Info (PeerID və Ad)

io.on('connection', socket => {
  
  // 1. Yeni gələnə mövcud otaqları göstər
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
    
    // Otaq yaranan kimi hamıya xəbər ver
    io.emit('room-list', rooms);
    // Yaradanı otağa yönləndir (join-room funksiyasını çağıracaq client tərəfdə)
    socket.emit('room-created', roomId);
  });

  // 3. Otağa Qoşulmaq
  socket.on('join-room', (roomId, userId, username) => { // userId = PeerJS ID
    // Otaq mövcuddurmu və yer varmı?
    const room = rooms[roomId];
    if (room && room.users.length < room.limit) {
      
      socket.join(roomId);
      
      // Server yaddaşında saxla
      const newUser = { id: userId, name: username };
      room.users.push(newUser);
      
      // Tez tapmaq üçün xəritələmə edirik
      socketToRoom[socket.id] = roomId;
      socketToUser[socket.id] = newUser;

      // Otaqdakılara yeni adamı xəbər ver
      socket.to(roomId).emit('user-connected', userId, username);
      
      // Yeni gələnə otaqdakıların siyahısını ver
      socket.emit('current-participants', room.users);

      // Bütün dünyaya (Lobby-ə) otaq sayının dəyişdiyini xəbər ver
      io.emit('room-list', rooms);

    } else {
      socket.emit('full-or-error', 'Otaq doludur və ya mövcud deyil!');
    }
  });

  // 4. ÇIXIŞ (Disconnect) - Ən vacib hissə
  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    const user = socketToUser[socket.id];

    if (roomId && user && rooms[roomId]) {
      // 1. Otaqdakılara xəbər ver ki, Peer əlaqəsini kəssinlər
      socket.to(roomId).emit('user-disconnected', user.id);
      
      // 2. İstifadəçini otaq siyahısından sil
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== user.id);

      // 3. Əgər otaq boş qaldısa, otağı sil
      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId];
      }

      // 4. Bütün dünyaya yenilənmiş siyahını göndər
      io.emit('room-list', rooms);
    }

    // Təmizlik işləri
    delete socketToRoom[socket.id];
    delete socketToUser[socket.id];
  });

  // Səs (Mute/Unmute) statusu
  socket.on('toggle-audio', (roomId, userId, isMuted) => {
      socket.to(roomId).emit('user-toggled-audio', userId, isMuted);
  });
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Server işləyir...');
});
