const net = require('net');

const startDummyServers = () => {
  // Start dummy TCP server (accepts Terraria client connections)
  dummyServer = net.createServer((socket) => {
    let dataBuffer = Buffer.alloc(0);

    console.info('Connection received on dummy server.');

    socket.on('data', chunk => {
      dataBuffer = Buffer.concat([dataBuffer, chunk]);
      const dataString = dataBuffer.toString('utf8', 4, 12);

      console.log(dataString);

      if (dataString === 'Terraria') {
        console.info('Detected real terraria server. Closing dummy servers and starting real tshock instance');
      
        socket.end(); // Immediately end the dummy connection
    
        // Stop the dummy and fake API servers
        dummyServer.close(() => console.info('Dummy server closed'));
        dummyServer = null;
        
        if (apiServer) {
          apiServer.close(() => console.info('Dummy API server closed'));
          apiServer = null;
        }
        
        
        // Start the real Terraria server
        startRealServer();
      } else {
        socket.destroy();
        console.info('Request made to dummy server, but request was not from terraria client');
      }
    });
  });

  dummyServer.on('error', err => console.error('Dummy server error:', err));

  dummyServer.listen(7777, () => {
    console.info(`Dummy TCP server listening on port ${7777}`);
  });
}

startDummyServers();