
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoom = 'global';
    let userId = Math.random().toString(36).substr(2, 9).toUpperCase();

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join':
                currentRoom = data.room || 'global';
                userId = data.userId || userId;
                if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Set());
                rooms.get(currentRoom).add({ ws, userId });
                console.log(`User ${userId} joined room ${currentRoom}`);
                break;

            case 'signal':
                // Relay WebRTC signals to the target user
                const room = rooms.get(currentRoom);
                if (room) {
                    room.forEach(client => {
                        if (client.userId === data.targetId && client.ws.readyState === WebSocket.OPEN) {
                            client.ws.send(JSON.stringify({
                                type: 'signal',
                                senderId: userId,
                                signal: data.signal
                            }));
                        }
                    });
                }
                break;
            
            case 'broadcast':
                // Relay data to all other users in the room
                const broadcastRoom = rooms.get(currentRoom);
                if (broadcastRoom) {
                    broadcastRoom.forEach(client => {
                        if (client.userId !== userId && client.ws.readyState === WebSocket.OPEN) {
                            client.ws.send(JSON.stringify({
                                type: 'broadcast',
                                senderId: userId,
                                data: data.data
                            }));
                        }
                    });
                }
                break;
        }
    });

    ws.on('close', () => {
        const room = rooms.get(currentRoom);
        if (room) {
            room.forEach(client => {
                if (client.ws === ws) room.delete(client);
            });
            if (room.size === 0) rooms.delete(currentRoom);
        }
    });
});

console.log('Aegis Tactical Signaling Server running on port 8080');
