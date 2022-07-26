const CANDIDATE_TYPES = {
  host: 0,
  srflx: 1,
  relay: 2
};

const CANDIDATE_TCP_TYPES = {
  active: 0,
  passive: 1,
  so: 2
}

const CANDIDATE_IDX = {
  TYPE: 0,
  PROTOCOL: 1,
  IP: 2,
  PORT: 3,
  RELATED_IP: 4,
  RELATED_PORT: 5,
  TCP_TYPE: 6
}

const STUN_ICE = [
  {urls: 'stun:stun1.l.google.com:19302'},
  {urls: 'stun:global.stun.twilio.com:3478'}
];

const TURN_UDP_ICE = [
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  }
];

const TURN_TCP_ICE = [
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  }
];

const POLL_INTERVAL_MS = 5000;

// How long until we expire entries in R2.
const STATE_EXPIRATION_MS = 2 * 60 * 1000;

// How long until expiration do we refresh
const REFRESH_WINDOW_MS = 30000;

const ROOM_ID = "room134";
const WORKER_URL = "https://signalling.minddrop.workers.dev"
//const WORKER_URL = "http://localhost:8787"

const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

const removePeerUi = (clientId) => {
  document.getElementById(clientId)?.remove();
}

const initPeerUi = (clientId) => {
  if (document.getElementById(clientId)) return;

  const peerEl = document.createElement("div");
  peerEl.style = "display: flex;"

  const name = document.createElement("div");
  name.innerText = clientId.substring(0, 5);

  peerEl.appendChild(name);

  const st = document.createElement("div");
  st.id = `${clientId}-ice-status`;
  st.style = "width: 32px; height 32px; background-color: blue;";
  peerEl.appendChild(st);

  const cst = document.createElement("div");
  cst.id = `${clientId}-conn-status`;
  cst.style = "width: 32px; height 32px; background-color: blue;";
  peerEl.appendChild(cst);

  const type = document.createElement("div");
  type.id = `${clientId}-type`;
  type.innerText = "?";
  peerEl.appendChild(type);

  const icetype = document.createElement("div");
  icetype.id = `${clientId}-ice-type`;
  icetype.innerText = "";
  peerEl.appendChild(icetype);

  peerEl.id = clientId;

  document.getElementById("peers").appendChild(peerEl);
};

const hexToBase64 = (hex) => {
  const d = [];

  for (let i = 0; i < hex.length; i += 2) {
    const v = `${hex[i]}${hex[i + 1]}`.toLowerCase();
    d.push(parseInt(v, 16));
  }

  // b64 is slightly more concise than colon-hex
  return btoa(String.fromCharCode.apply(String, d));
}

const base64ToHex = (b64) => {
  const raw = atob(b64);
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const hex = raw.charCodeAt(i).toString(16);
    result += (hex.length === 2 ? hex : '0' + hex);
  }
  return result.toLowerCase();
};

function arrayBufferToBase64( buffer ) {
    var binary = '';
    var bytes = new Uint8Array( buffer );
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode( bytes[ i ] );
    }
    return window.btoa( binary );
}

// parseCandidate from https://github.com/fippo/sdp
const parseCandidate = (line) => {
  let parts;

  // Parse both variants.
  if (line.indexOf('a=candidate:') === 0) {
    parts = line.substring(12).split(' ');
  } else {
    parts = line.substring(10).split(' ');
  }

  const candidate = [
    CANDIDATE_TYPES[parts[7]], // type
    parts[2].toLowerCase() === "udp" ? 0 : 1, // protocol
    parts[4], // ip
    parseInt(parts[5], 10), // port
  ];

  for (let i = 8; i < parts.length; i += 2) {
    switch (parts[i]) {
      case 'raddr':
        while (candidate.length < 5) candidate.push(null);
        candidate[4] = parts[i + 1];
        break;
      case 'rport':
        while (candidate.length < 6) candidate.push(null);
        candidate[5] = parseInt(parts[i + 1], 10);
        break;
      case 'tcptype':
        while (candidate.length < 7) candidate.push(null);
        candidate[6] = CANDIDATE_TCP_TYPES[parts[i + 1]];
        break;
      default: // Unknown extensions are silently ignored.
        break;
    }
  }

  while (candidate.length < 8) candidate.push(null);
  candidate[7] = parseInt(parts[3], 10); // Priority last

  return candidate;
};

function arrayBufferToHex (arrayBuffer) {
  if (typeof arrayBuffer !== 'object' || arrayBuffer === null || typeof arrayBuffer.byteLength !== 'number') {
    throw new TypeError('Expected input to be an ArrayBuffer')
  }

  var view = new Uint8Array(arrayBuffer)
  var result = ''
  var value

  for (var i = 0; i < view.length; i++) {
    value = view[i].toString(16)
    result += (value.length === 1 ? '0' + value : value)
  }

  return result
}

function randomHex (bytes) {
  const view = new Uint8Array(bytes)

  if (typeof crypto === 'object' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(view)
  } else if (typeof msCrypto === 'object' && typeof msCrypto.getRandomValues === 'function') {
    msCrypto.getRandomValues(view)
  } else {
    throw new Error('No secure random number generator available')
  }

  return arrayBufferToHex(view.buffer)
}

const generateRandomString = (length = 20, wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/') =>
  Array.from(crypto.getRandomValues(new Uint32Array(length))).map((x) => wishlist[x % wishlist.length]).join('');

const clientId = randomHex(20);

if (!history.state?.contextId) {
    history.replaceState({ ...history.state, contextId: randomHex(20)}, window.location.href);
}

const contextId = history.state.contextId;

(async function() {
  const getNetworkSettings = async (dtlsCert) => {
    let dtlsFingerprint = null;
    const candidates = [];
    const reflexiveIps = new Set();

    let iceServers = STUN_ICE;

    const pc = new RTCPeerConnection({ iceServers, certificates: [dtlsCert] });
    pc.createDataChannel("foo");

    const p = new Promise(res => {
      pc.onicecandidate = e => {
        if (!e.candidate) {
          return res();
        }

        if (e.candidate.candidate) {
          candidates.push(parseCandidate(e.candidate.candidate));
        }
      };
    });

    pc.createOffer().then(offer => {
      for (const l of offer.sdp.split("\n")) {
        if (l.indexOf("a=fingerprint") == -1) continue;
        dtlsFingerprint = l.split(" ")[1].trim();
      }

      pc.setLocalDescription(offer)
    });

    await p;

    pc.close();

    let isSymmetric = false;
    let udpEnabled = false;

    // Network is not symmetric if we can find a srflx candidate that has a unique related port
    loop:
    for (const c of candidates) {
      if (c[0] !== CANDIDATE_TYPES.srflx) continue;
      udpEnabled = true;

      reflexiveIps.add(c[CANDIDATE_IDX.IP]);

      for (const d of candidates) {
        if (d[0] !== CANDIDATE_TYPES.srflx) continue;
        if (c === d) continue;

        if (typeof(c[CANDIDATE_IDX.RELATED_PORT]) === "number" &&
            typeof(d[CANDIDATE_IDX.RELATED_PORT]) === "number" &&
            c[CANDIDATE_IDX.RELATED_PORT] === d[CANDIDATE_IDX.RELATED_PORT] &&
            c[CANDIDATE_IDX.PORT] !== d[CANDIDATE_IDX.PORT]) { // check port and related port
          // Symmetric, continue
          isSymmetric = true;
          break;
        }
      }
    }

    if (document.location.toString().indexOf("?symtest") >= 0) {
      isSymmetric = true;
    }

    return [udpEnabled, isSymmetric, reflexiveIps, dtlsFingerprint];
  };

  const t0 = performance.now();
  const dtlsCert = await RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" });
 
  let udpEnabled, isSymmetric, reflexiveIps, dtlsFingerprint;

  [udpEnabled, isSymmetric, reflexiveIps, dtlsFingerprint] = await getNetworkSettings(dtlsCert); 

  document.getElementById("client").innerText = clientId.substring(0, 5) + " " + [...reflexiveIps].join(", ") + " " + Math.floor(Math.random() * 100000);

  setInterval(async () => {
    [udpEnabled, isSymmetric, reflexiveIps, dtlsFingerprint] = await getNetworkSettings(dtlsCert); 

    document.getElementById("client").innerText = clientId.substring(0, 5) + " " + [...reflexiveIps].join(", ") + " " + Math.floor(Math.random() * 100000);
  }, 5000);

  const createSdp = (isOffer, iceUFrag, icePwd, dtlsFingerprintBase64) => {
    const dtlsHex = base64ToHex(dtlsFingerprintBase64);
    let dtlsFingerprint = "";

    for (let i = 0; i < dtlsHex.length; i += 2) {
      dtlsFingerprint += `${dtlsHex[i]}${dtlsHex[i+1]}${i === dtlsHex.length - 2 ? '' : ':'}`.toUpperCase();
    }

    const sdp = ['v=0',
      'o=- 5498186869896684180 2 IN IP4 127.0.0.1',
      's=-', 't=0 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      'a=sctp-port:5000'
    ];

    if (isOffer) {
      sdp.push('a=setup:actpass');
    } else {
      sdp.push('a=setup:active');
    }

    sdp.push(`a=ice-ufrag:${iceUFrag}`);
    sdp.push(`a=ice-pwd:${icePwd}`);
    sdp.push(`a=fingerprint:sha-256 ${dtlsFingerprint}`);

    //let priority = 1;

    //for (const c of candidates) {
    //}

    return sdp.join("\r\n") + "\r\n";
  }

  const handlePeerInfos = (function() {
    const remotePeerRoles = new Map(); // true if offer, false if answer
    const remoteSdps = new Map();
    const packageReceivedFromPeers = new Set();

    return (peers, localJoinedAtTimestamp, localPeerData, localDtlsCert, localDtlsFingerprintBase64, localPackages, remotePeerDatas, remotePackages) => {
      const removePeer = clientId => {
        if (!peers.has(clientId)) return;
        const peer = peers.get(clientId);
        removePeerUi(clientId);
        peers.delete(clientId);
        peer.close();
      };

      const [localClientId, localSymmetric] = localPeerData;
      const now = new Date().getTime();
      const seenRemoteClientIds = new Set();

      for (const remotePeerData of remotePeerDatas) {
        const [remoteClientId, remoteSymmetric, remoteDtlsFingerprintBase64, remoteJoinedAtTimestamp, remoteReflexiveIps] = remotePeerData;

        seenRemoteClientIds.add(remoteClientId);
        initPeerUi(remoteClientId);

        //Peer A is:
        //  - if both not symmetric or both symmetric, whoever has the most recent data is peer A, since we want Peer B created faster,
        //    and latency will be lowest with older data.
        //  - if one is and one isn't, the non symmetric one is the only one who has valid candidates, so the symmetric one is peer A
        const isPeerA = localSymmetric === remoteSymmetric ? localJoinedAtTimestamp > remoteJoinedAtTimestamp : localSymmetric;

        // If either side is symmetric, use TURN and hope we avoid connecting via relays
        // We can't just use TURN if both sides are symmetric because one side might be port restricted and hence won't connect without a relay.
        const iceServers = localSymmetric || remoteSymmetric ? (udpEnabled ? TURN_UDP_ICE : TURN_TCP_ICE) : STUN_ICE;

        const iceTypeEl = document.getElementById(`${remoteClientId}-ice-type`);

        if (iceTypeEl) {
          iceTypeEl.innerText = iceServers === TURN_UDP_ICE ? "TU" : iceServers === TURN_TCP_ICE ? "TT" : "S";
        }

        // Firefox answer side is very aggressive with ICE timeouts, so always delay answer set until second candidates received.
        const delaySetRemoteUntilReceiveCandidates = isFirefox;

        if (isPeerA) {
          //  - I create PC
          //  - I create an answer SDP, and munge the ufrag
          //  - Set local description with answer
          //  - Set remote description via the received sdp
          //  - Add the ice candidates

          for (const [localClientId, remoteClientId, remoteIceUFrag, remoteIcePwd, remoteDtlsFingerprintBase64, localIceUFrag, localIcePwd, sentAt, remoteCandidates] of remotePackages) {
            if (peers.has(remoteClientId)) continue;

            initPeerUi(remoteClientId);
            const typeEl = document.getElementById(`${remoteClientId}-type`);

            if (typeEl && typeEl.innerText === "?") {
              typeEl.innerText = isPeerA ? "A" : "B"
            }

            typeEl.innerText = "A!";

            // If we already added the candidates from B, skip. This check is not strictly necessary given the peer will exist.
            if (packageReceivedFromPeers.has(remoteClientId)) continue;
            packageReceivedFromPeers.add(remoteClientId);

            // I am peer A, I only care if packages have been published to me.
            const pc = new RTCPeerConnection({ iceServers, certificates: [ localDtlsCert ] });
            pc.createDataChannel("signal");
            peers.set(remoteClientId, pc);

            // Special case if both behind sym NAT or other hole punching isn't working: peer A needs to send its candidates as well.
            const pkg = [remoteClientId, localClientId, /* lfrag */null, /* lpwd */null, /* ldtls */null, /* remote ufrag */ null, /* remote Pwd */ null, now, []];
            const pkgCandidates = pkg[pkg.length - 1];

            pc.onicecandidate = e => {
              if (!e.candidate) {
                if (pkgCandidates.length > 0) {
                  // If hole punch hasn't worked after two seconds, send these candidates back to B to help it punch through.
                  localPackages.push(pkg);
                }

                return;
              }

              if (!e.candidate.candidate) return;
              pkgCandidates.push(e.candidate.candidate);
            };

            pc.oniceconnectionstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;

              if (iceConnectionState === "connected") {
                document.getElementById(`${remoteClientId}-ice-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: green;');
              } else if (iceConnectionState === "failed") {
                document.getElementById(`${remoteClientId}-ice-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: red;');
                removePeer(remoteClientId);
              } else {
                document.getElementById(`${remoteClientId}-ice-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: yellow;');
              }

              console.log("iceconnectionstatechange", remoteClientId.substring(0, 5), iceConnectionState, iceGatheringState);
            }

            pc.onicegatheringstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;
              console.log("icegatheringstatechange", remoteClientId.substring(0, 5), iceConnectionState, iceGatheringState);
            }

            pc.onconnectionstatechange = () => {
              const connectionState = pc.connectionState;
              console.log("connectionstatechange", remoteClientId.substring(0, 5), connectionState);

              if (connectionState === "connected") {
                document.getElementById(`${remoteClientId}-conn-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: green;');
              } else if (connectionState === "failed") {
                document.getElementById(`${remoteClientId}-conn-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: red;');
                removePeer(remoteClientId);
              } else {
                document.getElementById(`${remoteClientId}-conn-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: yellow;');
              }
            }

            pc.onsignalingstatechange = () => {
              const signalingState = pc.signalingState;
              console.log("signalingstatechange", remoteClientId.substring(0, 5), signalingState);
            }

            const remoteSdp = createSdp(true, remoteIceUFrag, remoteIcePwd, remoteDtlsFingerprintBase64);

            pc.setRemoteDescription({ type: "offer", sdp: remoteSdp });

            pc.createAnswer().then(answer => {
              const lines = [];

              for (const l of answer.sdp.split("\r\n")) {
                if (l.startsWith("a=ice-ufrag")) {
                  lines.push(`a=ice-ufrag:${localIceUFrag}`);
                } else if (l.startsWith("a=ice-pwd")) {
                  lines.push(`a=ice-pwd:${localIcePwd}`);
                } else {
                  lines.push(l);
                }
              }

              pc.setLocalDescription({ type: "answer", sdp: lines.join("\r\n") });
              
              typeEl.innerText = "A:" + remoteCandidates.length;
              console.log("Add remote candidates", remoteClientId);

              for (const candidate of remoteCandidates) {
                pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
              }
            });
          }
        } else {
          const typeEl = document.getElementById(`${remoteClientId}-type`);

          if (typeEl && typeEl.innerText === "?") {
            typeEl.innerText = isPeerA ? "A" : "B"
          }

          // I am peer B, I need to create a peer first if none exists, and send a package.
          //   - Create PC
          //   - Create offer
          //   - Set local description as-is
          //   - Generate ufrag + pwd
          //   - Generate remote SDP using the dtls fingerprint for A, and my generated ufrag + pwd
          //   - Add an srflx candidate for each of the reflexive IPs for A (on a random port) to hole punch
          //   - Set remote description
          //     so peer reflexive candidates for it show up.
          //   - Let trickle run, then once trickle finishes send a package for A to pick up = [my client id, my offer sdp, generated ufrag/pwd, dtls fingerprint, ice candidates]
          //   - keep the icecandidate listener active, and add the pfrlx candidates when they arrive (but don't send another package)
          if (!peers.has(remoteClientId)) {
            const pc = new RTCPeerConnection({ iceServers, certificates: [ localDtlsCert ] });
            pc.createDataChannel("signal");
            peers.set(remoteClientId, pc);

            const remoteUfrag = generateRandomString(12);
            const remotePwd = generateRandomString(32);
            let trickleDone = false;

            // This is the 'package' sent to peer B that it needs to start ICE
            const pkg = [remoteClientId, localClientId, /* lfrag */null, /* lpwd */null, /* ldtls */null, remoteUfrag, remotePwd, now, []];
            const pkgCandidates = pkg[pkg.length - 1];

            // The other peer posts its reflexive IPs to try to speed up hole punching.
            let remoteSdp = createSdp(false, remoteUfrag, remotePwd, remoteDtlsFingerprintBase64);

            for (let i = 0; i < remoteReflexiveIps.length; i++) {
              remoteSdp += `a=candidate:0 1 udp ${i + 1} ${remoteReflexiveIps[i]} 30000 typ srflx\r\n`;
            }

            pc.onicecandidate = e => {
              // Push package onto the given package list, so it will be sent in next polling step.
              if (!e.candidate) return localPackages.push(pkg);

              if (!e.candidate.candidate) return;
              pkgCandidates.push(e.candidate.candidate);
            };

            pc.oniceconnectionstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;

              if (iceConnectionState === "connected") {
                document.getElementById(`${remoteClientId}-ice-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: green;');
              } else if (iceConnectionState === "failed") {
                document.getElementById(`${remoteClientId}-ice-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: red;');
                removePeer(remoteClientId);
              } else {
                document.getElementById(`${remoteClientId}-ice-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: yellow;');
              }

              console.log("iceconnectionstatechange", remoteClientId.substring(0, 5), iceConnectionState, iceGatheringState);
            }

            pc.onicegatheringstatechange = () => {
              const iceConnectionState = pc.iceConnectionState;
              const iceGatheringState = pc.iceGatheringState;
              console.log("icegatheringstatechange", remoteClientId.substring(0, 5), iceConnectionState, iceGatheringState);
            }

            pc.onconnectionstatechange = () => {
              const connectionState = pc.connectionState;
              console.log("connectionstatechange", remoteClientId.substring(0, 5), connectionState);

              if (connectionState === "connected") {
                document.getElementById(`${remoteClientId}-conn-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: green;');
              } else if (connectionState === "failed") {
                document.getElementById(`${remoteClientId}-conn-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: red;');
                removePeer(remoteClientId);
              } else {
                document.getElementById(`${remoteClientId}-conn-status`).setAttribute('style', 'width: 32px; height: 32px; background-color: yellow;');
              }
            }

            pc.onsignalingstatechange = () => {
              const signalingState = pc.signalingState;
              console.log("signalingstatechange", remoteClientId.substring(0, 5), signalingState);
            }

            pc.createOffer().then(offer => {
              pc.setLocalDescription(offer);

              for (const l of offer.sdp.split("\r\n")) {
                switch (l.split(':')[0]) {
                  case 'a=ice-ufrag':
                    pkg[2] = l.substring(12);
                    break;
                  case 'a=ice-pwd':
                    pkg[3] = l.substring(10);
                    break;
                  case 'a=fingerprint':
                    pkg[4] = hexToBase64(l.substring(22).replaceAll(":",""))
                    break;
                }
              }


              if (!delaySetRemoteUntilReceiveCandidates) {
                pc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
              } else {
                pc._pendingRemoteSdp = remoteSdp;
              }
            });
          }

          // Peer B will also receive candidates in the case where hole punch fails.
          for (const [, remoteClientId, , , , , , , remoteCandidates] of remotePackages) {
            // If we already added the candidates from A, skip
            if (packageReceivedFromPeers.has(remoteClientId)) continue;
            if (!peers.has(remoteClientId)) continue;
            initPeerUi(remoteClientId);

            const typeEl = document.getElementById(`${remoteClientId}-type`);

            if (typeEl && typeEl.innerText === "?") {
              typeEl.innerText = isPeerA ? "A" : "B"
            }

            const pc = peers.get(remoteClientId);

            if (delaySetRemoteUntilReceiveCandidates && !pc.remoteDescription && pc._pendingRemoteSdp) {
              console.log("Add remote candidates", remoteClientId);

              pc.setRemoteDescription({ type: "answer", sdp: pc._pendingRemoteSdp }).then(() => {
                delete pc._pendingRemoteSdp;

                typeEl.innerText = "B::" + remoteCandidates.length;

                if (pc.iceConnectionState !== "connected") {
                  for (const candidate of remoteCandidates) {
                    pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
                  }
                }

                packageReceivedFromPeers.add(remoteClientId);
              });

              packageReceivedFromPeers.add(remoteClientId);
            }

            if (!delaySetRemoteUntilReceiveCandidates && pc.remoteDescription && remoteCandidates.length > 0) {
              typeEl.innerText = "B:" + remoteCandidates.length;
              console.log("Add remote candidates", remoteClientId);

              if (pc.iceConnectionState !== "connected") {
                for (const candidate of remoteCandidates) {
                  pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
                }
              }

              packageReceivedFromPeers.add(remoteClientId);
            }
          }
        }
      }

      for (const [clientId, peer] of peers.entries()) {
        if (seenRemoteClientIds.has(clientId)) continue;
        removePeer(clientId);
      }
    };
  })();

  const step = (function() {
    let dataTimestamp = null;
    let isSending = false;
    let packages = [];
    let lastPackagesLength = null;
    let sentFirstPoll = false;
    let joinedAtTimestamp = new Date().getTime();
    let nextStepTime = -1;
    let stopFastPollingAt = -1;
    let deleteKey = null;
    const peers = new Map();

    return async (finish = false) => {
      const now = new Date().getTime();
      if (!finish && nextStepTime > now) return;

      if (!finish && isSending) return;
      isSending = true;

      try {
        const localDtlsFingerprintBase64 = hexToBase64(dtlsFingerprint.replaceAll(":", ""));

        const localPeerInfo =  [
          clientId,
          isSymmetric,
          localDtlsFingerprintBase64,
          joinedAtTimestamp,
          [...reflexiveIps]
        ];

        const payload = { r: ROOM_ID, k: contextId };

        if (finish) {
          payload.dk = deleteKey;
        }

        const expired = dataTimestamp === null || (now - dataTimestamp) >= STATE_EXPIRATION_MS - REFRESH_WINDOW_MS;
        const packagesChanged = lastPackagesLength !== packages.length;
        let includePackages = false;

        if (expired || packagesChanged || finish) {
          // This will force a write
          dataTimestamp = now;
          
          // Compact packages, expire any of them sent more than a minute ago. (ICE will timeout by then, even if KV latency fails us.)
          for (let i = 0; i < packages.length; i++) {
            const sentAt = packages[i][packages[i].length - 2];

            if (now - sentAt > 60 * 1000) {
              packages[i] = null;
            }
          }

          while (packages.indexOf(null) >= 0) {
            packages.splice(packages.indexOf(null), 1);
          }

          includePackages = true;
        }

        if (finish) {
          includePackages = false;
        }

        // The first poll should just be a read, no writes, to build up packages before we do a write
        // to reduce worker I/O. So don't include the data + packages on the first request.
        if (sentFirstPoll) {
          payload.d = localPeerInfo;
          payload.t = dataTimestamp;
          payload.x = STATE_EXPIRATION_MS;

          if (includePackages) {
            payload.p = packages;
            lastPackagesLength = packages.length;
          }
        }

        let body = JSON.stringify(payload);
        const deflatedBody = arrayBufferToBase64(pako.deflate(body));
        const headers = { 'Content-Type': 'application/json '};
        let keepalive = false;

        if (body.length > deflatedBody.length) {
          body = deflatedBody;
          headers["Content-Type"] = "application/json";
          headers["Content-Encoding"] = "text/plain";
          headers["Content-Length"] = deflatedBody.length;
        }

        if (finish) {
          headers["X-Worker-Method"] = "DELETE";
          keepalive = true;
        }

        const res = await fetch(WORKER_URL, { method: "POST", headers, body, keepalive })
        
        const { ps: responsePeerList, pk: responsePackages, dk } = await res.json();

        if (dk) {
          deleteKey = dk;
        }

        if (finish) return;

        // Slight optimization: if the peers are empty on the first poll, immediately publish data to reduce
        // delay before first peers show up.
        if (responsePeerList.length === 0 && !sentFirstPoll) {
          payload.d = localPeerInfo;
          payload.t = dataTimestamp;
          payload.x = STATE_EXPIRATION_MS;
          payload.p = packages;
          lastPackagesLength = packages.length;

          const res = await fetch(WORKER_URL, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const { dk } = await res.json();

          if (dk) {
            deleteKey = dk;
          }
        }

        sentFirstPoll = true;

        const previousPeerClientIds = [...peers.keys()];

        // This returns true if we added a peer, candidate, or other side effect in the last run.
        handlePeerInfos(peers, joinedAtTimestamp, localPeerInfo, dtlsCert, localDtlsFingerprintBase64, packages, responsePeerList, responsePackages);

        const activeClientIds = responsePeerList.map(p => p[0]);

        const peersChanged = previousPeerClientIds.length !== activeClientIds.length || activeClientIds.find(c => !previousPeerClientIds.includes(c)) || previousPeerClientIds.find(c => !activeClientIds.includes(c));

        // Rate limit requests when room is empty, or look for new joins 
        // Go faster when things are changing to avoid ICE timeouts
        if (peersChanged) {
          stopFastPollingAt = now + 10000;
        }

        if (now < stopFastPollingAt) {
          document.getElementById("speed").innerText = "Fast";
          nextStepTime = now + 750;
        } else {
          document.getElementById("speed").innerText = "Slow";
          nextStepTime = now + 5000;
        }

      } catch (e) {
        console.error(e);
        nextStepTime = now + 1000;
      } finally {
        isSending = false;
      }
    }
  })()

  step();

  setInterval(step, 500);

  document.addEventListener('visibilitychange', function logData() {
    if (document.visibilityState === 'hidden') {
      step(true);
    }
  });
})();
