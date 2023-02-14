const WebSocket = require('ws')

// Shell command:
// for i in {1..10}; node stress-test.js;

const socket = new WebSocket('ws://127.0.0.1:3333')
socket.on('open', () => {
  socket.send(
    '["REQ","feed:global",{"kinds":[1],"limit":1000}]'
  )
})
socket.on('message', (data) => {
  console.log(data.toString())
})
