import P2PCF from './p2pcf.js'

if (!document.location.hash) {
  document.location =
    document.location.toString() +
    `#room-example-${Math.floor(Math.random() * 100000)}`
}

let turnIceServers = null

const twilioUsername = new URLSearchParams(document.location.search)
  .twilio_username
const twilioCredential = new URLSearchParams(document.location.search)
  .twilio_credential

if (twilioCredential && twilioUsername) {
  turnIceServers = [
    {
      username: twilioUsername,
      credential: twilioCredential,
      url: 'turn:global.turn.twilio.com:3478?transport=udp',
      urls: 'turn:global.turn.twilio.com:3478?transport=udp'
    },
    {
      username: twilioUsername,
      credential: twilioCredential,
      url: 'turn:global.turn.twilio.com:3478?transport=tcp',
      urls: 'turn:global.turn.twilio.com:3478?transport=tcp'
    },
    {
      username: twilioUsername,
      credential: twilioCredential,
      url: 'turn:global.turn.twilio.com:443?transport=tcp',
      urls: 'turn:global.turn.twilio.com:443?transport=tcp'
    }
  ]
}

const p2pcf = new P2PCF('testguy', document.location.hash.substring(1), {
  turnIceServers
})
window.p2pcf = p2pcf

const removePeerUi = clientId => {
  document.getElementById(clientId)?.remove()
  document.getElementById(`${clientId}-video`)?.remove()
}

const addPeerUi = sessionId => {
  if (document.getElementById(sessionId)) return

  const peerEl = document.createElement('div')
  peerEl.style = 'display: flex;'

  const name = document.createElement('div')
  name.innerText = sessionId.substring(0, 5)

  peerEl.id = sessionId
  peerEl.appendChild(name)

  document.getElementById('peers').appendChild(peerEl)
}

const addMessage = message => {
  const messageEl = document.createElement('div')
  messageEl.innerText = message

  document.getElementById('messages').appendChild(messageEl)
}

let stream

p2pcf.on('peerconnect', peer => {
  console.log('Peer connect', peer.id, peer)
  if (stream) {
    peer.addStream(stream)
  }

  peer.on('track', (track, stream) => {
    console.log('got track', track)
    const video = document.createElement('video')
    video.id = `${peer.id}-video`
    video.srcObject = stream
    video.setAttribute('playsinline', true)
    document.getElementById('videos').appendChild(video)
    video.play()
  })

  addPeerUi(peer.id)
})

p2pcf.on('peerclose', peer => {
  console.log('Peer close', peer.id, peer)
  removePeerUi(peer.id)
})

p2pcf.on('msg', (peer, data) => {
  addMessage(
    peer.id.substring(0, 5) + ': ' + new TextDecoder('utf-8').decode(data)
  )
})

p2pcf.start()

export const waitForEvent = function (eventName, eventObj) {
  return new Promise(resolve => {
    eventObj.addEventListener(eventName, resolve, { once: true })
  })
}

const go = () => {
  document.getElementById('session-id').innerText =
    p2pcf.sessionId.substring(0, 5) + '@' + p2pcf.roomId + ':'

  document.getElementById('send-button').addEventListener('click', () => {
    const box = document.getElementById('send-box')
    addMessage(p2pcf.sessionId.substring(0, 5) + ': ' + box.value)
    p2pcf.broadcast(new TextEncoder().encode(box.value))
    box.value = ''
  })

  document
    .getElementById('video-button')
    .addEventListener('click', async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: true })

      for (const peer of p2pcf.peers.values()) {
        peer.addStream(stream)
      }
    })
}

if (
  document.readyState === 'complete' ||
  document.readyState === 'interactive'
) {
  go()
} else {
  window.addEventListener('DOMCOntentLoaded', go, { once: true })
}
