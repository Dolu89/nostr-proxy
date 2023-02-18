const WebSocket = require('ws')

// Shell command:
// for i in {1..10}; node stress-test.js;

const socket = new WebSocket('wss://nproxy.cc')
socket.on('open', () => {
  socket.send(
    '["REQ","feed:global",{"kinds":[1],"limit":100}]'
  )
})
socket.on('message', (data) => {
  console.log(data.toString())
})
